import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { escucharInstalacion } from "@/lib/push";

// El navegador avisa muy temprano que la app se puede instalar (fase 3.4b)
escucharInstalacion();

createRoot(document.getElementById("root")!).render(<App />);
