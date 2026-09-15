import fs from 'node:fs';
const path = 'app/(tabs)/index.tsx';
let s = fs.readFileSync(path, 'utf8');
const replacements = [
  ['backgroundColor: "#123A53"', 'backgroundColor: "#111111"'],
  ['color: "#A8D3DB"', 'color: "#D9D9D9"'],
  ['color: "#D5E7EA"', 'color: "#EAEAEA"'],
  ['backgroundColor: "#E9F8F4"', 'backgroundColor: "#F4F4F4"'],
  ['color: "#16785D"', 'color: "#111111"'],
  ['backgroundColor: "#FFF9F7"', 'backgroundColor: "#F7F7F7"'],
  ['borderColor: "#F26B5E"', 'borderColor: "#111111"'],
  ['color: "#1E9B6B"', 'color: "#111111"'],
];
for (const [a,b] of replacements) s = s.split(a).join(b);
s = s.replace('خصم يصل إلى 40%', 'خصم يصل إلى 70%');
s = s.replace('خصم يصل إلى 70%"</Text><Text style={styles.bannerSub}>على منتجات مختارة', 'خصم يصل إلى 70%"</Text><Text style={styles.bannerSub}>عروض الموسم الجديدة');
s = s.replace('<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{categories.map', '<View style={styles.catalogTools}><Text style={styles.catalogCount}>{filtered.length} منتجات</Text><View style={styles.toolButtons}><Pressable style={styles.toolButton}><Icon name="tune" size={17} /><Text style={styles.toolText}>فلاتر</Text></Pressable><Pressable style={styles.toolButton}><Icon name="sort" size={17} /><Text style={styles.toolText}>ترتيب</Text></Pressable></View></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{categories.map');
s = s.replace('navText: { color: "#8DA1AA", fontSize: 10, marginTop: 3 }', 'navText: { color: "#8DA1AA", fontSize: 10, marginTop: 3, fontWeight: "600" }');
s = s.replace('const styles = StyleSheet.create({', 'const styles = StyleSheet.create({ catalogTools: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 3 }, catalogCount: { color: "#777", fontSize: 12, textAlign: "right" }, toolButtons: { flexDirection: "row-reverse", gap: 7 }, toolButton: { flexDirection: "row-reverse", alignItems: "center", gap: 4, borderWidth: 1, borderColor: "#E5E5E5", paddingHorizontal: 11, paddingVertical: 7, backgroundColor: "#fff" }, toolText: { color: "#222", fontSize: 11, fontWeight: "700" },');
fs.writeFileSync(path, s);
console.log('fashion ui refined');
