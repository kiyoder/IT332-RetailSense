import { ArrowRight, ArrowUp, Filter } from "lucide-react"

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative w-1/3">
          <label className="text-sm text-gray-500">Timeframe:</label>
          <div className="flex justify-between items-center mt-1 p-2 border border-gray-300 rounded-md">
            <span>All-time</span>
            <span>▼</span>
          </div>
        </div>

        <div className="relative w-1/3">
          <label className="text-sm text-gray-500">People:</label>
          <div className="flex justify-between items-center mt-1 p-2 border border-gray-300 rounded-md">
            <span>All</span>
            <span>▼</span>
          </div>
        </div>

        <div className="relative w-1/3">
          <label className="text-sm text-gray-500">Topic:</label>
          <div className="flex justify-between items-center mt-1 p-2 border border-gray-300 rounded-md">
            <span>All</span>
            <span>▼</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <div className="flex justify-between items-center">
            <h3 className="text-3xl font-bold">210</h3>
            <span className="text-orange-400">👥</span>
          </div>
          <p className="text-gray-500 mt-1">Total visitors</p>
          <div className="flex items-center mt-2 text-green-500 text-sm">
            <ArrowUp size={16} />
            <span>+1.01% this week</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm">
          <div className="flex justify-between items-center">
            <h3 className="text-3xl font-bold">2:30 - 4:30 pm</h3>
            <span className="text-orange-400">🕒</span>
          </div>
          <p className="text-gray-500 mt-1">Peak Hours</p>
          <div className="flex items-center mt-2 text-green-500 text-sm">
            <ArrowUp size={16} />
            <span>+4.49% this week</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm">
          <div className="flex justify-between items-center">
            <h3 className="text-3xl font-bold">Entrance, Aisle</h3>
            <ArrowRight className="text-orange-400" />
          </div>
          <p className="text-gray-500 mt-1">Popular Zones</p>
          <div className="flex items-center mt-2 text-green-500 text-sm">
            <ArrowUp size={16} />
            <span>+5.26% this week</span>
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg">Generated Heatmap</h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-red-500"></span>
                <span className="text-xs">High Traffic</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                <span className="text-xs">Medium</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                <span className="text-xs">Low</span>
              </div>
              <Filter size={16} />
            </div>
          </div>
          <div className="h-80 bg-gray-100 rounded-md flex items-center justify-center">
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-RQEFh9vdrXwSK1QMBcSd74LKNQCe12.png"
              alt="Heatmap visualization"
              className="max-h-full object-contain"
              style={{ maxWidth: "100%", height: "auto" }}
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg">Hourly Trend</h3>
            <div className="flex items-center gap-2">
              <span className="text-sm">Month</span>
              <span>▼</span>
            </div>
          </div>
          <div className="h-80 bg-gray-100 rounded-md">
            {/* Chart would go here - using a placeholder */}
            <div className="h-full w-full flex items-center justify-center">
              <div className="w-full h-full p-4 flex items-end justify-between">
                {["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].map(
                  (month, i) => (
                    <div key={month} className="flex flex-col items-center gap-2">
                      <div
                        className="w-6 bg-blue-400 rounded-t-sm"
                        style={{ height: `${Math.random() * 150 + 50}px` }}
                      ></div>
                      <span className="text-xs text-gray-500">{month}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reports History */}
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">Reports History</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm">Monthly</span>
            <span>▼</span>
          </div>
        </div>

        <table className="w-full">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">No</th>
              <th className="pb-2">ID</th>
              <th className="pb-2">Date</th>
              <th className="pb-2">Document Name</th>
              <th className="pb-2">Document Type</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="py-4">1</td>
              <td className="py-4">#12594</td>
              <td className="py-4">Oct 15, 2023</td>
              <td className="py-4">Document 1</td>
              <td className="py-4">PDF</td>
              <td className="py-4">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Success
                </span>
              </td>
              <td className="py-4">•••</td>
            </tr>
            <tr>
              <td className="py-4">2</td>
              <td className="py-4">#19400</td>
              <td className="py-4">Mar 30, 2025</td>
              <td className="py-4">March 2025- Visitor</td>
              <td className="py-4">CSV</td>
              <td className="py-4">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Success
                </span>
              </td>
              <td className="py-4">•••</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
