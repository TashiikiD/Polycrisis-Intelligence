import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import BriefMode from './pages/BriefMode'
import PulseMode from './pages/PulseMode'
import NetworkView from './pages/NetworkView'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/brief" element={<BriefMode />} />
        <Route path="/pulse" element={<PulseMode />} />
        <Route path="/network" element={<NetworkView />} />
      </Routes>
    </Layout>
  )
}

export default App
