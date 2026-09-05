with open('src/renderer/components/RightPanel.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Fix ALL remaining non-ASCII chars
import re

# Replace specific known patterns
text = text.replace('\u017d', '')  # Ž stray
text = text.replace('\u2014', '-')  # em dash -> hyphen

# Remove any other non-ASCII chars
text = re.sub(r'[^\x00-\x7F]', '', text)

# Clean up double spaces left behind
text = re.sub(r'  +', ' ', text)
# Clean up empty icon strings
text = text.replace("icon: ''", "icon: '?'")
# Fix "Drop weather pin" that lost its leading content
text = text.replace("'Drop weather pin'", "'Drop weather pin'")
# Fix leading space in section titles
text = text.replace('"rip-section-title"> ', '"rip-section-title">')

with open('src/renderer/components/RightPanel.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

print('Done - all non-ASCII removed')
