/**
 * Import Service — parses KML and KMZ files into GeoJSON-like features
 * for display on the map.
 *
 * KML: XML parsed with @xmldom/xmldom (Node.js — no browser DOMParser)
 * KMZ: Unzipped with adm-zip, then parse the doc.kml inside
 *
 * Extracts: Placemarks (Point, LineString, Polygon), Folders, MultiGeometry
 *
 * NOTE: @xmldom/xmldom is a partial DOM implementation — it does NOT
 * support querySelector/querySelectorAll. All element lookups use
 * getElementsByTagName and manual child iteration.
 */

import { DOMParser } from '@xmldom/xmldom'
import type { Element as XMLElement, Document as XMLDocument, Node as XMLNode } from '@xmldom/xmldom'
import AdmZip from 'adm-zip'

export interface ImportedFeature {
  id: string
  name: string
  type: 'point' | 'line' | 'polygon'
  coords: { lng: number; lat: number }[]
  description?: string
  styleColor?: string
  folder?: string
}

export interface ImportResult {
  features: ImportedFeature[]
  /** Bounding box of all features [SW, NE]. */
  bounds: [{ lng: number; lat: number }, { lng: number; lat: number }]
  fileName: string
  featureCount: number
}

/* ------------------------------------------------------------------ */
/* xmldom helper functions (replaces querySelector)                    */
/* ------------------------------------------------------------------ */

/** Get all direct children of a node with the given tag name. */
function directChildren(node: XMLNode, tagName: string): XMLElement[] {
  const result: XMLElement[] = []
  const el = node as XMLElement
  if (!el.getElementsByTagName) return result
  const all = el.getElementsByTagName(tagName)
  for (let i = 0; i < all.length; i++) {
    if (all[i].parentNode === node) result.push(all[i])
  }
  return result
}

/** Get the first direct child of a node with the given tag name. */
function firstChild(node: XMLNode, tagName: string): XMLElement | null {
  const children = directChildren(node, tagName)
  return children[0] || null
}

/** Get the first descendant (any depth) with the given tag name. */
function firstDescendant(node: XMLNode, tagName: string): XMLElement | null {
  const el = node as XMLElement
  if (!el.getElementsByTagName) return null
  const all = el.getElementsByTagName(tagName)
  return all.length > 0 ? all[0] : null
}

/** Get text content of an element (xmldom supports textValue). */
function textOf(el: XMLElement | null): string {
  if (!el) return ''
  // xmldom elements have 'textContent' in newer versions, 'textValue' in older
  return (el.textContent || (el as unknown as { textValue?: string }).textValue || '').trim()
}

/** Get an element by ID from the document (xmldom supports getElementById). */
function byId(doc: XMLDocument, id: string): XMLElement | null {
  // xmldom's getElementById only works if the DTD declares ID attributes.
  // KML doesn't, so we manually search for id attributes.
  const all = doc.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    if (all[i].getAttribute('id') === id) return all[i]
  }
  return null
}

/* ------------------------------------------------------------------ */
/* KML / KMZ parsing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Parse a KML or KMZ file from disk.
 */
export function parseKmlFile(filePath: string): ImportResult {
  const fileName = filePath.split(/[\\/]/).pop() || 'imported'

  let kmlText: string
  if (filePath.toLowerCase().endsWith('.kmz')) {
    const zip = new AdmZip(filePath)
    const entries = zip.getEntries()
    const docEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('.kml'))
    if (!docEntry) throw new Error('No KML file found inside KMZ archive')
    kmlText = docEntry.getData().toString('utf8')
  } else {
    const fs = require('fs')
    kmlText = fs.readFileSync(filePath, 'utf8')
  }

  return parseKmlString(kmlText, fileName)
}

/**
 * Parse a KML string into ImportedFeature[].
 */
export function parseKmlString(kmlText: string, fileName: string = 'imported'): ImportResult {
  const parser = new DOMParser()
  const doc = parser.parseFromString(kmlText, 'text/xml')

  // xmldom doesn't produce parsererror elements; instead check the root
  const root = doc.documentElement
  if (!root) throw new Error('Invalid KML: empty document')

  const features: ImportedFeature[] = []
  let idCounter = 0

  // Walk through all Placemarks, tracking folder context
  function walkPlacemarks(node: XMLElement, folderPath: string) {
    // Track folder names
    let currentFolder = folderPath
    if (node.tagName === 'Folder') {
      const nameEl = firstChild(node, 'name')
      const folderName = textOf(nameEl)
      currentFolder = folderPath ? `${folderPath}/${folderName}` : folderName
    }

    const children = node.childNodes
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.nodeType !== 1) continue // Element.nodeType = 1
      const el = child as XMLElement
      if (el.tagName === 'Placemark') {
        const feature = parsePlacemark(el, currentFolder, idCounter++, doc)
        if (feature) features.push(feature)
      } else if (el.tagName === 'Folder' || el.tagName === 'Document') {
        walkPlacemarks(el, currentFolder)
      }
    }
  }

  walkPlacemarks(root, '')

  // Compute bounds
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const f of features) {
    for (const c of f.coords) {
      minLng = Math.min(minLng, c.lng)
      minLat = Math.min(minLat, c.lat)
      maxLng = Math.max(maxLng, c.lng)
      maxLat = Math.max(maxLat, c.lat)
    }
  }

  const bounds: [{ lng: number; lat: number }, { lng: number; lat: number }] =
    features.length > 0
      ? [{ lng: minLng, lat: minLat }, { lng: maxLng, lat: maxLat }]
      : [{ lng: 0, lat: 0 }, { lng: 0, lat: 0 }]

  return { features, bounds, fileName, featureCount: features.length }
}

function parsePlacemark(pm: XMLElement, folder: string, id: number, doc: XMLDocument): ImportedFeature | null {
  const nameEl = firstChild(pm, 'name')
  const descEl = firstChild(pm, 'description')
  const name = textOf(nameEl) || `Feature ${id}`
  const description = textOf(descEl) || undefined

  // Style color
  const styleUrlEl = firstChild(pm, 'styleUrl')
  const styleUrl = textOf(styleUrlEl)
  let styleColor: string | undefined
  if (styleUrl) {
    const styleId = styleUrl.replace('#', '')
    // Try id-based lookup first, then search for Style elements
    let style = byId(doc, styleId)
    if (!style) {
      // Fallback: search for <Style id="..."> elements
      const styles = doc.getElementsByTagName('Style')
      for (let i = 0; i < styles.length; i++) {
        if (styles[i].getAttribute('id') === styleId) {
          style = styles[i]
          break
        }
      }
    }
    if (style) {
      // Look for color in IconStyle, LineStyle, or PolyStyle (first match wins)
      let colorEl: XMLElement | null = null
      for (const styleTag of ['IconStyle', 'LineStyle', 'PolyStyle']) {
        const styleContainer = firstDescendant(style, styleTag)
        if (styleContainer) {
          colorEl = firstDescendant(styleContainer, 'color')
          if (colorEl) break
        }
      }
      const kmlColor = textOf(colorEl)
      if (kmlColor.length >= 8) {
        // KML colors are AABBGGRR — convert to #RRGGBB
        const r = kmlColor.slice(6, 8)
        const g = kmlColor.slice(4, 6)
        const b = kmlColor.slice(2, 4)
        styleColor = `#${r}${g}${b}`
      }
    }
  }

  // Point
  const pointEl = firstDescendant(pm, 'Point')
  const pointCoords = pointEl ? firstDescendant(pointEl, 'coordinates') : null
  if (pointCoords) {
    const coords = parseCoordinates(textOf(pointCoords))
    if (coords.length > 0) {
      return { id: `import-${id}`, name, type: 'point', coords: [coords[0]], description, styleColor, folder }
    }
  }

  // LineString
  const lineEl = firstDescendant(pm, 'LineString')
  const lineCoords = lineEl ? firstDescendant(lineEl, 'coordinates') : null
  if (lineCoords) {
    const coords = parseCoordinates(textOf(lineCoords))
    if (coords.length > 0) {
      return { id: `import-${id}`, name, type: 'line', coords, description, styleColor, folder }
    }
  }

  // Polygon (outer boundary only)
  const polygon = firstDescendant(pm, 'Polygon')
  if (polygon) {
    const outerBoundary = firstDescendant(polygon, 'outerBoundaryIs')
    const linearRing = outerBoundary ? firstDescendant(outerBoundary, 'LinearRing') : null
    const polyCoords = linearRing ? firstDescendant(linearRing, 'coordinates') : null
    if (polyCoords) {
      const coords = parseCoordinates(textOf(polyCoords))
      if (coords.length > 0) {
        return { id: `import-${id}`, name, type: 'polygon', coords, description, styleColor, folder }
      }
    }
  }

  // MultiGeometry — collect ALL geometries, not just the first
  const multi = firstDescendant(pm, 'MultiGeometry')
  if (multi) {
    // Gather all Point, LineString, Polygon children
    const points = directChildren(multi, 'Point')
    const lines = directChildren(multi, 'LineString')
    const polys = directChildren(multi, 'Polygon')

    // If there's a single geometry, return it directly
    const totalGeoms = points.length + lines.length + polys.length
    if (totalGeoms === 1) {
      if (points.length === 1) {
        const c = firstDescendant(points[0], 'coordinates')
        if (c) {
          const coords = parseCoordinates(textOf(c))
          if (coords.length > 0) return { id: `import-${id}`, name, type: 'point', coords: [coords[0]], description, styleColor, folder }
        }
      }
      if (lines.length === 1) {
        const c = firstDescendant(lines[0], 'coordinates')
        if (c) {
          const coords = parseCoordinates(textOf(c))
          if (coords.length > 0) return { id: `import-${id}`, name, type: 'line', coords, description, styleColor, folder }
        }
      }
      if (polys.length === 1) {
        const ob = firstDescendant(polys[0], 'outerBoundaryIs')
        const lr = ob ? firstDescendant(ob, 'LinearRing') : null
        const c = lr ? firstDescendant(lr, 'coordinates') : null
        if (c) {
          const coords = parseCoordinates(textOf(c))
          if (coords.length > 0) return { id: `import-${id}`, name, type: 'polygon', coords, description, styleColor, folder }
        }
      }
    }

    // Multiple geometries — merge all coordinates into a single line
    // (most useful for tracks that are split into segments)
    if (totalGeoms > 1) {
      const allCoords: { lng: number; lat: number }[] = []
      for (const line of lines) {
        const c = firstDescendant(line, 'coordinates')
        if (c) allCoords.push(...parseCoordinates(textOf(c)))
      }
      for (const poly of polys) {
        const ob = firstDescendant(poly, 'outerBoundaryIs')
        const lr = ob ? firstDescendant(ob, 'LinearRing') : null
        const c = lr ? firstDescendant(lr, 'coordinates') : null
        if (c) allCoords.push(...parseCoordinates(textOf(c)))
      }
      for (const point of points) {
        const c = firstDescendant(point, 'coordinates')
        if (c) {
          const pc = parseCoordinates(textOf(c))
          if (pc.length > 0) allCoords.push(pc[0])
        }
      }
      if (allCoords.length > 0) {
        return { id: `import-${id}`, name, type: 'line', coords: allCoords, description, styleColor, folder }
      }
    }
  }

  return null
}

function parseCoordinates(text: string): { lng: number; lat: number }[] {
  const coords: { lng: number; lat: number }[] = []
  const tuples = text.trim().split(/\s+/)
  for (const t of tuples) {
    const parts = t.split(',')
    const lng = parseFloat(parts[0])
    const lat = parseFloat(parts[1])
    if (!isNaN(lng) && !isNaN(lat)) {
      coords.push({ lng, lat })
    }
  }
  return coords
}
