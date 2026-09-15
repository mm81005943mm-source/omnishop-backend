import fs from 'node:fs';
const storePath = 'lib/omnishop-store.tsx';
let store = fs.readFileSync(storePath, 'utf8');
store = store.replace('export type Product = { id: string;', 'export type Product = { image?: string; id: string;');
const imgs = {
'p1':'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=800&q=85',
'p2':'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=85',
'p3':'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&q=85',
'p4':'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&q=85',
'p5':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=800&q=85',
'p6':'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&q=85'
};
for (const [id,url] of Object.entries(imgs)) store = store.replace(`{ id: "${id}",`, `{ image: "${url}", id: "${id}",`);
fs.writeFileSync(storePath, store);
const path = 'app/(tabs)/index.tsx';
let s = fs.readFileSync(path, 'utf8');
s = s.replace('<View style={[styles.productImage, { backgroundColor: product.color }]}><Text style={{ fontSize: compact ? 52 : 64 }}>{product.emoji}</Text>', '<View style={[styles.productImage, { backgroundColor: product.color }]}>{product.image ? <Image source={{ uri: product.image }} style={styles.productPhoto} /> : <Text style={{ fontSize: compact ? 52 : 64 }}>{product.emoji}</Text>}');
s = s.replace('<View style={[styles.detailImage, { backgroundColor: selected.color }]}><Text style={{ fontSize: 110 }}>{selected.emoji}</Text></View>', '<View style={[styles.detailImage, { backgroundColor: selected.color }]}>{selected.image ? <Image source={{ uri: selected.image }} style={styles.detailPhoto} /> : <Text style={{ fontSize: 110 }}>{selected.emoji}</Text>}</View>');
s = s.replace('productImage: { height: 145,', 'productImage: { height: 185,');
s = s.replace('detailImage: { height: 280,', 'productPhoto: { width: "100%", height: "100%" }, detailPhoto: { width: "100%", height: "100%" }, detailImage: { height: 320,');
fs.writeFileSync(path, s);
console.log('fashion catalog images applied');
