/// <reference types="vite/client" />

interface Window {
  ethereum?: import('ethers').Eip1193Provider & {
    on?: (event: string, listener: (...args: unknown[]) => void) => void
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
  }
}
