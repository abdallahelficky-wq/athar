import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/i18n";
import "../../src/styles/global.css";
import PositionsTab from "../../src/wired/PositionsTab";
createRoot(document.getElementById("root")).render(<div className="settings-page"><PositionsTab /></div>);
