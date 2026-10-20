import React from "react";
import { createRoot } from "react-dom/client";
import MayaApp from "./MayaApp.jsx";
import "./maya.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MayaApp />
  </React.StrictMode>
);
