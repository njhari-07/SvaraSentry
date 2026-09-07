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
      {/* Floating View Switcher Bar for instant access */}
      <nav
        aria-label="View Switcher"
        style={{
          position: "fixed",
          top: "14px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          backgroundColor: "rgba(10, 12, 22, 0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          padding: "4px",
          borderRadius: "9999px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
        }}
      >
        <button
          type="button"
          onClick={goToLanding}
          style={{
            padding: "6px 16px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontFamily: "monospace",
            fontWeight: 500,
            cursor: "pointer",
            border: view === "landing" ? "1px solid rgba(255, 255, 255, 0.3)" : "1px solid transparent",
            backgroundColor: view === "landing" ? "rgba(255, 255, 255, 0.18)" : "transparent",
            color: view === "landing" ? "#ffffff" : "#A0A8C0",
            transition: "all 0.2s",
          }}
        >
          SvaraSentry Overview
        </button>
        <button
          type="button"
          onClick={goToDashboard}
          style={{
            padding: "6px 16px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontFamily: "monospace",
            fontWeight: 500,
            cursor: "pointer",
            border: view === "dashboard" ? "1px solid rgba(63, 140, 255, 0.5)" : "1px solid transparent",
            backgroundColor: view === "dashboard" ? "rgba(63, 140, 255, 0.25)" : "transparent",
            color: view === "dashboard" ? "#9ec5ff" : "#A0A8C0",
            transition: "all 0.2s",
          }}
        >
          Live Interior Dashboard
        </button>
      </nav>

      {view === "dashboard" ? (
        <div className="pt-12">
          <Dashboard onBackToLanding={goToLanding} />
        </div>
      ) : (
        <iframe
          src="/ink.html"
          title="SvaraSentry Overview"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            border: "none",
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
}
