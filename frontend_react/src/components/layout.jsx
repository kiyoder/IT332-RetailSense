"use client"

import { Outlet } from "react-router-dom"
import Sidebar, { useSidebar } from "./sidebar"
import Header from "./header"
import { useTheme } from "../context/theme-context"

export default function Layout() {
  const { theme } = useTheme()

  return (
    <div
      className={`flex h-screen ${
        theme === "dark" ? "bg-gray-900" : "bg-gray-50"
      } transition-colors duration-200`}
    >
      <Sidebar />
      <LayoutContent />
    </div>
  )
}

function LayoutContent() {
  const { collapsed } = useSidebar()

  return (
    <div
      className={`flex-1 transition-all duration-300 ease-in-out ${
        collapsed ? "pl-16" : "pl-64"
      }`}
    >
      <Header />
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  )
}
