"use client";

import { useSyncExternalStore } from "react";
import { Dashboard } from "@/components/dashboard";

type View = "landing" | "dashboard";

function subscribeToView(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

function getViewSnapshot(): View {
  return window.location.hash === "#dashboard" ? "dashboard" : "landing";
}

function getServerViewSnapshot(): View {
  return "landing";
}

export default function HomePage() {
  const view = useSyncExternalStore(subscribeToView, getViewSnapshot, getServerViewSnapshot);

  const goToDashboard = () => {
    window.location.hash = "dashboard";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToLanding = () => {
    window.location.hash = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          backgroundColor: "rgba(10, 12, 22, 0.88)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          padding: "5px",
          borderRadius: "9999px",
          boxShadow: "0 20px 30px -5px rgba(0, 0, 0, 0.65), 0 0 15px rgba(63, 140, 255, 0.15)",
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
            border: view === "landing" ? "1px solid rgba(255, 255, 255, 0.3)" : "1px solid transparent",
            backgroundColor: view === "landing" ? "rgba(255, 255, 255, 0.18)" : "transparent",
            color: view === "landing" ? "#ffffff" : "#A0A8C0",
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
            border: view === "dashboard" ? "1px solid rgba(63, 140, 255, 0.5)" : "1px solid transparent",
            backgroundColor: view === "dashboard" ? "rgba(63, 140, 255, 0.25)" : "transparent",
            color: view === "dashboard" ? "#9ec5ff" : "#A0A8C0",
            transition: "all 0.2s",
          }}
        >
          Live Dashboard
        </button>
      </nav>

      {view === "dashboard" ? (
        <div className="pt-8">
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
