const express = require("express");
const path = require("path");
const instaRoutes = require("./routes/instaRoutes/instaRoutes");

const app = express();
PORT = 4000;
require("dotenv").config();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "templates"));

app.get("/", (req, res) => {
  res.render("index");
});

app.use("/api/instaLink", instaRoutes);

app.listen(PORT, () => {
  console.log(`Sewrver Started at http://localhost:${PORT}`);
});
