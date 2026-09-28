import DownloadPage from "../../src/pages/DownloadPage";
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import "../../src/i18n";
import "../../src/styles/global.css";
import LandingPage from "../../src/pages/LandingPage";
import LoginPage from "../../src/pages/LoginPage";
import {AuthProvider} from "../../src/context/AuthContext";
function App(){const [page,setPage]=useState("landing");return <AuthProvider>{page === "landing" ? <LandingPage onGoLogin={()=>setPage("login")} onGoRegister={()=>setPage("register")} onGoDownload={()=>setPage("download")} onGoDataProtection={()=>setPage("protection")} /> : page === "download" ? <DownloadPage /> : page === "login" ? <LoginPage onGoLanding={()=>setPage("landing")} onGoRegister={()=>setPage("register")} onGoForgotPassword={()=>setPage("forgot")} /> : <div data-testid="destination">{page}<button onClick={()=>setPage("landing")}>Back</button></div>}</AuthProvider>;}createRoot(document.getElementById("root")).render(<App />);
