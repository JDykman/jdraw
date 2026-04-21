import { jsx } from "react/jsx-runtime";
import { createContext, useContext, useState } from "react";

// Mock the state atom that Tldraw expects
const mockState = {
  get: () => 'licensed',
  listen: () => () => {},
  value: 'licensed'
};

const LicenseContext = createContext({
  state: mockState,
  outputMessages: () => {},
} as any);

export const useLicenseContext = () => useContext(LicenseContext);
export const LICENSE_TIMEOUT = 999999;

export function LicenseProvider({ children }: { children: any }) {
  const [licenseManager] = useState(() => ({
    state: mockState,
    outputMessages: () => {},
  }));
  
  return jsx(LicenseContext.Provider, { 
    value: licenseManager, 
    children: children 
  });
}
