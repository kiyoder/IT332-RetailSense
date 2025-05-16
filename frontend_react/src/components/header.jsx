"use client"
import { useState } from "react"
import { ChevronDown, Search, Menu, Sun, Moon, User, LogOut, Settings } from "lucide-react"
import { useAuth } from "../AuthContext"
import { useSidebar } from "./sidebar"
import { useTheme } from "../context/theme-context"
import { Link } from "react-router-dom"

export default function Header() {
  const { user, profile, signOut } = useAuth()
  const { collapsed, toggleSidebar } = useSidebar()
  const { theme, toggleTheme } = useTheme()
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const toggleDropdown = () => {
    setDropdownOpen(!dropdownOpen)
  }

  const handleLogout = async () => {
    try {
      await signOut()
      // Navigate to login page is handled by the AuthContext
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 transition-colors duration-200">
      <div className="flex justify-between items-center px-6 py-4">
        <div className="flex items-center gap-4">
          {collapsed && (
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200"
            >
              <Menu size={20} className="text-gray-700 dark:text-gray-300" />
            </button>
          )}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Welcome Back, {profile?.username || "User"}
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search..."
              className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors duration-200"
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
          </button>

          {/* User Profile Dropdown */}
          <div className="relative">
            <div
              className="flex items-center gap-2 cursor-pointer p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={toggleDropdown}
            >
              <div className="h-10 w-10 rounded-full bg-gray-300 overflow-hidden">
                <img
                  src={`https://ui-avatars.com/api/?name=${profile?.username || "User"}&background=random`}
                  alt="User avatar"
                  className="h-full w-full object-cover"
                />
              </div>
              <span className="text-gray-900 dark:text-white">{profile?.username || "User"}</span>
              <ChevronDown
                size={16}
                className={`text-gray-500 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
              />
            </div>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 z-10 border border-gray-200 dark:border-gray-700">
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
