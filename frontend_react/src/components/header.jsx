"use client"
import { useState } from "react"
import { ChevronDown, Search, Menu, Sun, Moon, User, LogOut, Settings } from "lucide-react"
import { useAuth } from "../AuthContext"
import { useSidebar } from "./sidebar"
import { useTheme } from "../context/theme-context"
import { Link, useNavigate } from "react-router-dom"

export default function Header() {
  const { user, profile, signOut } = useAuth()
  const { collapsed, toggleSidebar } = useSidebar()
  const { theme, toggleTheme } = useTheme()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const navigate = useNavigate()

  const toggleDropdown = () => {
    setDropdownOpen(!dropdownOpen)
  }

  const handleLogout = async () => {
    try {
      await signOut()
      navigate("/login")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 transition-colors duration-200 shadow-sm">
      <div className="flex justify-between items-center px-6 py-4">
        <div className="flex items-center gap-4">
          {collapsed && (
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200"
            >
              <Menu size={20} className="text-gray-700 dark:text-gray-300" />
            </button>
          )}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
              Welcome Back, {profile?.username || "User"}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Here's what's happening with your store today
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all duration-200 hover:shadow-md"
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
          </button>

          {/* User Profile Dropdown */}
          <div className="relative">
            <button
              className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200"
              onClick={toggleDropdown}
            >
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 overflow-hidden shadow-md">
                <img
                  src={`https://ui-avatars.com/api/?name=${profile?.username || "User"}&background=random`}
                  alt="User avatar"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="hidden md:block text-left">
                <span className="block text-sm font-medium text-gray-900 dark:text-white">
                  {profile?.username || "User"}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {profile?.role || "User"}
                </span>
              </div>
              <ChevronDown
                size={16}
                className={`text-gray-500 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-lg py-2 z-10 border border-gray-200 dark:border-gray-700">
                <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {profile?.username || "User"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {profile?.email || "user@example.com"}
                  </p>
                </div>
                <Link
                  to="/profile"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => setDropdownOpen(false)}
                >
                  <User size={16} />
                  <span>Profile</span>
                </Link>
                <Link
                  to="/settings"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => setDropdownOpen(false)}
                >
                  <Settings size={16} />
                  <span>Settings</span>
                </Link>
                <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 w-full text-left"
                >
                  <LogOut size={16} />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
