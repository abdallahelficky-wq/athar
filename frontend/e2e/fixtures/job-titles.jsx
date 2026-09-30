import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../src/i18n";
import "../../src/styles/global.css";
import { AuthProvider } from "../../src/context/AuthContext";
import JobTitlesTab from "../../src/wired/hr/JobTitlesTab";
createRoot(document.getElementById("root")).render(<MemoryRouter><AuthProvider><JobTitlesTab /></AuthProvider></MemoryRouter>);
