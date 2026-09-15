import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }
const connection = await mysql.createConnection(url);
const checks = [
  ["addresses.userId -> users.id", "SELECT COUNT(*) AS count FROM addresses a LEFT JOIN users u ON u.id=a.userId WHERE u.id IS NULL"],
  ["orders.userId -> users.id", "SELECT COUNT(*) AS count FROM orders o LEFT JOIN users u ON u.id=o.userId WHERE u.id IS NULL"],
  ["orders.addressId -> addresses.id", "SELECT COUNT(*) AS count FROM orders o LEFT JOIN addresses a ON a.id=o.addressId WHERE o.addressId IS NOT NULL AND a.id IS NULL"],
  ["order_items.orderId -> orders.id", "SELECT COUNT(*) AS count FROM order_items i LEFT JOIN orders o ON o.id=i.orderId WHERE o.id IS NULL"],
  ["order_items.productId -> products.id", "SELECT COUNT(*) AS count FROM order_items i LEFT JOIN products p ON p.id=i.productId WHERE p.id IS NULL"],
  ["favorites.userId -> users.id", "SELECT COUNT(*) AS count FROM favorites f LEFT JOIN users u ON u.id=f.userId WHERE u.id IS NULL"],
  ["favorites.productId -> products.id", "SELECT COUNT(*) AS count FROM favorites f LEFT JOIN products p ON p.id=f.productId WHERE p.id IS NULL"],
  ["reviews.userId -> users.id", "SELECT COUNT(*) AS count FROM reviews r LEFT JOIN users u ON u.id=r.userId WHERE u.id IS NULL"],
  ["reviews.productId -> products.id", "SELECT COUNT(*) AS count FROM reviews r LEFT JOIN products p ON p.id=r.productId WHERE p.id IS NULL"],
];
let failed = false;
for (const [label, query] of checks) { try { const [rows] = await connection.query(query); const count = Number(rows[0].count); console.log(`${count === 0 ? "OK" : "FAIL"} ${label}: ${count}`); if (count > 0) failed = true; } catch (error) { console.error(`ERROR ${label}: ${error.message}`); failed = true; } }
await connection.end();
if (failed) { console.error("Foreign-key preflight failed. Do not apply drizzle/0004_mysterious_vengeance.sql until orphan records are repaired."); process.exit(1); }
console.log("Foreign-key preflight passed. No orphan records found.");
