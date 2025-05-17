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
} from "lucide-react"

export const SidebarContext = createContext({
  collapsed: false,
  toggleSidebar: () => {},
})

export const useSidebar = () => useContext(SidebarContext)

const navItems = [
  { title: "Overview", icon: BarChart2, path: "/overview" },
  { title: "Upload", icon: Upload, path: "/upload" },
  { title: "Floorplan", icon: LayoutPanelTop, path: "/floorplan" },
  { title: "Heatmap", icon: Thermometer, path: "/heatmap" },
  { title: "Analytics Center", icon: BarChart2, path: "/analytics" },
  { title: "Reports", icon: FileText, path: "/reports" },
]

const bottomNavItems = [
  { title: "Help Centre", icon: HelpCircle, path: "/help" },
  { title: "Contact us", icon: MessageSquare, path: "/contact" },
]

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
        } fixed h-full bg-[#0f1033] text-white transition-all duration-300 ease-in-out z-10`}
      >
        <div className="flex justify-between items-center p-4">
          {!collapsed && (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-orange-400 flex items-center justify-center">
                <span className="text-white font-bold">R</span>
              </div>
              <span className="font-bold text-lg">RetailSense</span>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            className={`${
              collapsed ? "mx-auto" : ""
            } text-white p-2 rounded-full hover:bg-blue-700 transition-all duration-200 ease-in-out hover:shadow-lg`}
          >
            {collapsed ? <Menu size={20} /> : <ChevronLeft size={20} />}
          </button>
        </div>

        <div className="mt-8">
          <ul>
            {navItems.map((item) => (
              <li key={item.title} className="mb-1 px-2">
                <Link
                  to={item.path}
                  className={`flex items-center py-3 px-4 rounded-lg transition-all duration-200 ease-in-out ${
                    isActive(item.path)
                      ? "bg-blue-700 shadow-md"
                      : "hover:bg-blue-800 hover:translate-x-1 hover:shadow-md"
                  } ${collapsed ? "justify-center" : "gap-3"}`}
                >
                  <item.icon
                    className={`${collapsed ? "mx-auto" : ""} transition-transform duration-200 ${
                      isActive(item.path) ? "text-white" : "text-gray-300"
                    } ${!isActive(item.path) && "group-hover:text-white"}`}
                    size={20}
                  />
                  {!collapsed && (
                    <span className={`${isActive(item.path) ? "font-medium" : ""} transition-all duration-200`}>
                      {item.title}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="absolute bottom-6 w-full">
          <ul>
            {bottomNavItems.map((item) => (
              <li key={item.title} className="mb-1 px-2">
                <Link
                  to={item.path}
                  className={`flex items-center py-3 px-4 rounded-lg transition-all duration-200 ease-in-out hover:bg-blue-800 hover:translate-x-1 hover:shadow-md ${
                    collapsed ? "justify-center" : "gap-3"
                  }`}
                >
                  <item.icon
                    className={`${collapsed ? "mx-auto" : ""} text-gray-300 transition-transform duration-200`}
                    size={20}
                  />
                  {!collapsed && <span>{item.title}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SidebarContext.Provider>
  )
}
