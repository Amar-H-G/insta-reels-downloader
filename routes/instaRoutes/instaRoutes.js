const express = require("express");
const videoDownloader = require("../../controllers/instaControllers/instaControllers");

const router = express.Router();

router.post("/urlLink", videoDownloader);

module.exports = router;
