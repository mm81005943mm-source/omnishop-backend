const express = require("express");

const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
  res.json({ message: "OmniShop Backend OK" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OmniShop Backend running on port ${PORT}`);
});
