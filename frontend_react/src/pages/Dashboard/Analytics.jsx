"use client"

import {
  BarChart2,
  Users,
  Activity,
  TrendingUp,
  Thermometer,
} from "lucide-react"

export default function AnalyticsPage() {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">Analytics Dashboard</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Total Visitors */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-5 flex items-center gap-4">
          <Users className="text-blue-500" size={28} />
          <div>
            <h3 className="text-sm text-gray-500 dark:text-gray-400">Total Visitors</h3>
            <p className="text-lg font-semibold text-gray-800 dark:text-white">12,340</p>
          </div>
        </div>

        {/* Avg. Dwell Time */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-5 flex items-center gap-4">
          <Activity className="text-green-500" size={28} />
          <div>
            <h3 className="text-sm text-gray-500 dark:text-gray-400">Avg. Dwell Time</h3>
            <p className="text-lg font-semibold text-gray-800 dark:text-white">3m 45s</p>
          </div>
        </div>

        {/* Engagement Rate */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-5 flex items-center gap-4">
          <TrendingUp className="text-purple-500" size={28} />
          <div>
            <h3 className="text-sm text-gray-500 dark:text-gray-400">Engagement Rate</h3>
            <p className="text-lg font-semibold text-gray-800 dark:text-white">68%</p>
          </div>
        </div>

        {/* Heatmap Interactions */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-5 flex items-center gap-4">
          <Thermometer className="text-red-500" size={28} />
          <div>
            <h3 className="text-sm text-gray-500 dark:text-gray-400">Heatmap Clicks</h3>
            <p className="text-lg font-semibold text-gray-800 dark:text-white">4,782</p>
          </div>
        </div>
      </div>

      {/* Placeholder for a future chart or graph */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6 h-64 flex items-center justify-center text-gray-500 dark:text-gray-400">
        Chart or Graph will be displayed here
      </div>
    </div>
  )
}
