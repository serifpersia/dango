import { render } from 'preact'
import { BrowserRouter } from 'react-router'
import App from './App'
import './styles/base.css'
import { SidebarProvider } from './contexts/SidebarProvider'
import { TitlePreferenceProvider } from './contexts/TitlePreferenceProvider'
import { LowEndModeProvider } from './contexts/LowEndModeProvider'
import { AnimePaheCookieProvider } from './contexts/AnimePaheCookieProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      refetchIntervalInBackground: false,
      retry: 1,
    },
  },
})

const root = document.getElementById('root')
if (root) {
  render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AnimePaheCookieProvider>
          <SidebarProvider>
            <TitlePreferenceProvider>
              <LowEndModeProvider>
                <App />
              </LowEndModeProvider>
            </TitlePreferenceProvider>
          </SidebarProvider>
        </AnimePaheCookieProvider>
      </QueryClientProvider>
    </BrowserRouter>,
    root
  )
}
