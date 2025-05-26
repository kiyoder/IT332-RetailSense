"use client"

import { useState, createContext, useContext } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  Upload,
  BarChart2,
  HelpCircle,
  Menu,
  MessageSquare,
  Thermometer,
  FileText,
  ChevronLeft,
  LayoutPanelTop,
  Settings,
  ListChecks,
  Home,
} from "lucide-react"

export const SidebarContext = createContext({
  collapsed: false,
  toggleSidebar: () => {},
})

export const useSidebar = () => useContext(SidebarContext)

const navItems = [
  { title: "Overview", icon: BarChart2, path: "/overview" },
  { title: "Upload", icon: Upload, path: "/upload" },
  { title: "Configure Floorplan", icon: Settings, path: "/configure-floorplan" },
  { title: "Floorplan", icon: LayoutPanelTop, path: "/floorplaneditor" },
  { title: "Completed Sessions", icon: ListChecks, path: "/completed-heatmaps" },
]

const bottomNavItems = []

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()

  const toggleSidebar = () => {
    setCollapsed(!collapsed)
  }

  const isActive = (path) => location.pathname === path

  return (
    <SidebarContext.Provider value={{ collapsed, toggleSidebar }}>
      <div
        className={`${
          collapsed ? "w-16" : "w-64"
        } fixed h-full bg-gradient-to-b from-[#0f1033] to-[#1a1b4b] text-white transition-all duration-300 ease-in-out z-10 shadow-xl`}
      >
        <div className="flex justify-between items-center p-4 border-b border-white/10">
          {!collapsed && (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-lg">R</span>
              </div>
              <span className="font-bold text-lg bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                RetailSense
              </span>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            className={`${
              collapsed ? "mx-auto" : ""
            } text-white/80 p-2 rounded-lg hover:bg-white/10 transition-all duration-200 ease-in-out hover:shadow-lg hover:text-white`}
          >
            {collapsed ? <Menu size={20} /> : <ChevronLeft size={20} />}
          </button>
        </div>

        <div className="mt-8 px-3">
          <ul className="space-y-2">
            {navItems.map((item) => (
              <li key={item.title}>
                <Link
                  to={item.path}
                  className={`flex items-center py-3 px-4 rounded-xl transition-all duration-200 ease-in-out group ${
                    isActive(item.path)
                      ? "bg-gradient-to-r from-blue-600 to-blue-700 shadow-lg shadow-blue-500/20"
                      : "hover:bg-white/10 hover:translate-x-1"
                  } ${collapsed ? "justify-center" : "gap-3"}`}
                >
                  <item.icon
                    className={`transition-transform duration-200 ${
                      isActive(item.path) 
                        ? "text-white" 
                        : "text-gray-400 group-hover:text-white"
                    }`}
                    size={20}
                  />
                  {!collapsed && (
                    <span className={`${
                      isActive(item.path) 
                        ? "font-medium text-white" 
                        : "text-gray-300 group-hover:text-white"
                    } transition-all duration-200`}>
                      {item.title}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="absolute bottom-6 w-full px-3">
          <ul className="space-y-2">
            {bottomNavItems.map((item) => (
              <li key={item.title}>
                <Link
                  to={item.path}
                  className={`flex items-center py-3 px-4 rounded-xl transition-all duration-200 ease-in-out hover:bg-white/10 hover:translate-x-1 ${
                    collapsed ? "justify-center" : "gap-3"
                  }`}
                >
                  <item.icon
                    className={`${collapsed ? "mx-auto" : ""} text-gray-400 group-hover:text-white transition-transform duration-200`}
                    size={20}
                  />
                  {!collapsed && <span className="text-gray-300 group-hover:text-white">{item.title}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SidebarContext.Provider>
  )
}
