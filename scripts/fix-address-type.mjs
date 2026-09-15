import fs from 'node:fs';
const path = 'app/(tabs)/index.tsx';
let s = fs.readFileSync(path, 'utf8');
s = s.replace('onPress: (value) => value && store.setAddress(value)', 'onPress: (value?: string) => value && store.setAddress(value)');
fs.writeFileSync(path, s);
