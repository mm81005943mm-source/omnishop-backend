import fs from 'node:fs';
const path = 'app/(tabs)/index.tsx';
let s = fs.readFileSync(path, 'utf8');
s = s.replace('reviewBox: { backgroundColor: "#F7F7F7", padding: 14, marginTop: 18, gap: 6 } }, app:', 'reviewBox: { backgroundColor: "#F7F7F7", padding: 14, marginTop: 18, gap: 6 }, app:');
fs.writeFileSync(path, s);
