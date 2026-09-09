"use client";

import { useState, useEffect } from "react";
import { Dashboard } from "@/components/dashboard";

export default function HomePage() {
  const [view, setView] = useState<"landing" | "dashboard">("landing");

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.location.hash === "#dashboard" || window.location.pathname === "/app") {
        setView("dashboard");
      }
    }

    const handleHash = () => {
      if (window.location.hash === "#dashboard") {
        setView("dashboard");
      } else if (window.location.hash === "#landing" || !window.location.hash) {
        setView("landing");
      }
    };

    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const goToDashboard = () => {
    setView("dashboard");
    if (typeof window !== "undefined") {
      window.location.hash = "dashboard";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const goToLanding = () => {
    setView("landing");
    if (typeof window !== "undefined") {
      window.location.hash = "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="relative min-h-screen bg-[#050507] text-[#faf6f0] antialiased">
      {/* Floating View Switcher Dock */}
      <nav
        aria-label="View Switcher"
        style={{
          position: "fixed",
          bottom: "24px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          backgroundColor: "rgba(18, 18, 20, 0.88)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          padding: "5px",
          borderRadius: "9999px",
          boxShadow: "0 20px 30px -5px rgba(0, 0, 0, 0.65)",
        }}
      >
        <button
          type="button"
          onClick={goToLanding}
          style={{
            padding: "7px 18px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontFamily: "monospace",
            fontWeight: 500,
            cursor: "pointer",
            border: view === "landing" ? "1px solid rgba(255, 255, 255, 0.28)" : "1px solid transparent",
            backgroundColor: view === "landing" ? "rgba(255, 255, 255, 0.14)" : "transparent",
            color: view === "landing" ? "#ffffff" : "#a1a1aa",
            transition: "all 0.2s",
          }}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={goToDashboard}
          style={{
            padding: "7px 18px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontFamily: "monospace",
            fontWeight: 500,
            cursor: "pointer",
            border: view === "dashboard" ? "1px solid rgba(255, 255, 255, 0.28)" : "1px solid transparent",
            backgroundColor: view === "dashboard" ? "rgba(255, 255, 255, 0.14)" : "transparent",
            color: view === "dashboard" ? "#ffffff" : "#a1a1aa",
            transition: "all 0.2s",
          }}
        >
          Live Dashboard
        </button>
      </nav>

      {view === "dashboard" ? (
        <div className="w-full">
          <Dashboard onBackToLanding={goToLanding} />
        </div>
      ) : (
        <iframe
          src="/ink.html"
          title=""
          aria-label="SvaraSentry Overview"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            border: "none",
            zIndex: 1,
            backgroundColor: "transparent",
          }}
        />
      )}
    </div>
  );
}
