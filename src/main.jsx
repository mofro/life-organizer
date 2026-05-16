import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import LifeOrganizer from './LifeOrganizer.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LifeOrganizer />
  </StrictMode>,
)
