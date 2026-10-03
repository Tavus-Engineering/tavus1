import React from "react";
import { createRoot } from "react-dom/client";
import ApexApp from "./ApexApp.jsx";
import "./apex.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ApexApp />
  </React.StrictMode>
);
