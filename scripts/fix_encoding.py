import re

with open('src/renderer/components/RightPanel.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace all remaining broken characters with clean equivalents
# These are leftover high bytes from double-encoding corruption
replacements = [
    # Comment/header artifacts
    ('\u20ac', '-'),   # € -> - (was em dash)
    ('\u2014\u201a', '-'),  # broken em dash + comma
    ('\u2014\u00b7', '-'),  # broken
    ('\u2013\u00b8', '>'),  # broken right arrow
    ('\u201d', ''),    # stray right quote
    ('\u201c', ''),    # stray left quote
    ('\u201e', ''),    # stray
    ('\u2030', ''),    # stray
    # Section title emoji replacements (use simple ASCII)
    ('\u00a7', ''),    # § broken emoji prefix
    ('\u00a1', ''),    # ¡ broken emoji
    ('\u00b9', ''),    # ¹ broken emoji
    ('\u00a2', ''),    # ¢ broken emoji
    ('\u201a', ''),    # ‚ broken
    ('\u00bd', ''),    # ½ broken
    ('\u00be', ''),    # ¾ broken
    ('\u00bf', ''),    # ¿ broken
    ('\u00ac', ''),    # ¬ broken
    ('\u00ad', ''),    # ­ broken
    ('\u00ae', ''),    # ® broken
    ('\u00af', ''),    # ¯ broken
    ('\u00b0', '\u00B0'),  # ° degree (keep)
    ('\u00b7', '\u00B7'),  # · middle dot (keep)
    ('\u00bb', ''),    # » broken
    ('\u00bc', ''),    # ¼ broken
    ('\u00f7', ''),    # ÷ broken
    ('\u00fe', ''),    # þ broken
    ('\u00ff', ''),    # ÿ broken
    ('\u00c2', ''),    # Â stray
    ('\u00c3', ''),    # Ã stray
    ('\u00c5', ''),    # Å stray
    ('\u00c6', ''),    # Æ stray
    ('\u00c7', ''),    # Ç stray
    ('\u00d0', ''),    # Ð stray
    ('\u00d1', ''),    # Ñ stray
    ('\u00d2', ''),    # Ò stray
    ('\u00d3', ''),    # Ó stray
    ('\u00d4', ''),    # Ô stray
    ('\u00d5', ''),    # Õ stray
    ('\u00d6', ''),    # Ö stray
    ('\u00d7', ''),    # × stray
    ('\u00d8', ''),    # Ø stray
    ('\u00d9', ''),    # Ù stray
    ('\u00da', ''),    # Ú stray
    ('\u00db', ''),    # Û stray
    ('\u00dc', ''),    # Ü stray
    ('\u00dd', ''),    # Ý stray
    ('\u00de', ''),    # Þ stray
    ('\u00df', ''),    # ß stray
    ('\u00e0', ''),    # à stray
    ('\u00e1', ''),    # á stray
    ('\u00e2', ''),    # â stray
    ('\u00e3', ''),    # ã stray
    ('\u00e4', ''),    # ä stray
    ('\u00e5', ''),    # å stray
    ('\u00e6', ''),    # æ stray
    ('\u00e7', ''),    # ç stray
    ('\u00e8', ''),    # è stray
    ('\u00e9', ''),    # é stray
    ('\u00ea', ''),    # ê stray
    ('\u00eb', ''),    # ë stray
    ('\u00ec', ''),    # ì stray
    ('\u00ed', ''),    # í stray
    ('\u00ee', ''),    # î stray
    ('\u00ef', ''),    # ï stray
    ('\u00f0', ''),    # ð stray
    ('\u00f1', ''),    # ñ stray
    ('\u00f2', ''),    # ò stray
    ('\u00f3', ''),    # ó stray
    ('\u00f4', ''),    # ô stray
    ('\u00f5', ''),    # õ stray
    ('\u00f6', ''),    # ö stray
    ('\u00f8', ''),    # ø stray
    ('\u00f9', ''),    # ù stray
    ('\u00fa', ''),    # ú stray
    ('\u00fb', ''),    # û stray
    ('\u00fc', ''),    # ü stray
    ('\u00fd', ''),    # ý stray
    ('\u2020', '+'),   # † -> + (was used for "→" cross-domain)
    ('\u2021', ''),    # ‡
    ('\u2022', '*'),   # • -> * (bullet)
    ('\u2026', '...'), # … -> ...
    ('\u20ac', '-'),   # € -> -
    # Box drawing (already escaped but some may remain)
    ('\u2500', '-'),
    ('\u2502', '|'),
    ('\u250c', '+'),
    ('\u2510', '+'),
    # Arrows
    ('\u2192', '->'),
    ('\u2190', '<-'),
    ('\u2191', '^'),
    ('\u2193', 'v'),
    ('\u21bb', '(r)'),  # ↻ refresh
    # Symbols
    ('\u26a0', '!'),   # ⚠ warning
    ('\u26a1', '!'),   # ⚡ lightning
    ('\u2713', 'OK'),  # ✓ check
    ('\u2715', 'X'),   # ✕ cross
    ('\u2764', '+'),   # ❤ heart
    ('\u2602', 'W'),   # umbrella (weather)
    ('\u25ce', 'O'),   # bullseye (stations)
    ('\u25a4', '#'),   # filled square (cams/traffic)
    ('\u224b', '~'),   # wave (ocean)
    ('\u25c8', '<>'),  # diamond (predict)
    ('\u26f5', 'P'),   # sail (grid/power)
    ('\u25c9', 'G'),   # globe (net)
    ('\u2744', '*'),   # snowflake (vpn)
    ('\u2756', 'D'),   # diamond (dns)
    # Cleanup: remove empty quotes where emoji was stripped
    # e.g. icon: '' -> icon: '?'
]

for old, new in replacements:
    text = text.replace(old, new)

# Fix specific patterns
text = text.replace("Weather ' Grid", "Weather -> Grid")
text = text.replace("' Refresh", "Refresh")
text = text.replace("' Clear pin", "Clear pin")
text = text.replace("' Click map to drop pin...", "Click map to drop pin...")
text = text.replace(" Drop weather pin", "Drop weather pin")

# Fix empty icon strings -> use first letter of label
def fix_empty_icon(m):
    label = m.group(1)
    return f"label: '{label}', icon: '{label[0]}'"

text = re.sub(r"label: '(\w+)', icon: ''", fix_empty_icon, text)

# Fix "CO‚‚" -> "CO2"
text = text.replace('CO\u201a\u201a', 'CO2')
text = text.replace('CO‚', 'CO2')

# Remove multiple consecutive blank lines
text = re.sub(r'\n{3,}', '\n\n', text)

with open('src/renderer/components/RightPanel.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

print('Done - cleaned all mojibake')
