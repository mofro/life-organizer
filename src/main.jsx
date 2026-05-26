import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AuthGuard from './AuthGuard.jsx'
import LifeOrganizer from './LifeOrganizer.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGuard>
      <LifeOrganizer />
    </AuthGuard>
  </StrictMode>,
)
