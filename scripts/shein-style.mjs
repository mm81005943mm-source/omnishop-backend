import fs from 'node:fs';
const theme = 'theme.config.js';
fs.writeFileSync(theme, `/** @type {const} */\nconst themeColors = {\n  primary: { light: '#111111', dark: '#FFFFFF' },\n  background: { light: '#FFFFFF', dark: '#111111' },\n  surface: { light: '#F7F7F7', dark: '#1B1B1B' },\n  foreground: { light: '#111111', dark: '#FFFFFF' },\n  muted: { light: '#777777', dark: '#BDBDBD' },\n  border: { light: '#E8E8E8', dark: '#363636' },\n  success: { light: '#278B55', dark: '#5DD48B' },\n  warning: { light: '#C98A16', dark: '#E9B84B' },\n  error: { light: '#D9363E', dark: '#FF747B' },\n};\nmodule.exports = { themeColors };\n`);
const path = 'app/(tabs)/index.tsx';
let s = fs.readFileSync(path, 'utf8');
const replacements = [
  ['backgroundColor: "#F8FAFB"', 'backgroundColor: "#FFFFFF"'],
  ['backgroundColor: "#F26B5E"', 'backgroundColor: "#111111"'],
  ['color: "#F26B5E"', 'color: "#111111"'],
  ['color: "#D9564B"', 'color: "#111111"'],
  ['backgroundColor: "#FFF0ED"', 'backgroundColor: "#F5F5F5"'],
  ['backgroundColor: "#FFE6E1"', 'backgroundColor: "#F1F1F1"'],
  ['borderRadius: 17, padding: 9', 'borderRadius: 0, padding: 8'],
  ['borderRadius: 13, alignItems: "center", justifyContent: "center"', 'borderRadius: 0, alignItems: "center", justifyContent: "center"'],
  ['borderRadius: 14, paddingHorizontal: 14', 'borderRadius: 0, paddingHorizontal: 14'],
  ['borderRadius: 9, paddingVertical: 8', 'borderRadius: 0, paddingVertical: 10'],
  ['borderRadius: 22, padding: 20', 'borderRadius: 0, padding: 20'],
  ['fontWeight: "900", color: "#102A43"', 'fontWeight: "900", color: "#111111"'],
  ['color: "#183B4B"', 'color: "#222222"'],
  ['color: "#102A43"', 'color: "#111111"'],
];
for (const [a,b] of replacements) s = s.split(a).join(b);
s = s.replace('مرحباً بك في', 'اكتشفي الجديد في');
s = s.replace('الأكثر مبيعاً', 'اختيارات الأسبوع');
s = s.replace('أضف للسلة', 'أضيفي للسلة');
s = s.replace('تسوق الآن', 'تسوقي الآن');
fs.writeFileSync(path, s);
console.log('shein-inspired visual style applied');
