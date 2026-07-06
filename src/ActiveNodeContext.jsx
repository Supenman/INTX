import { createContext, useContext } from 'react';

export const ActiveNodeContext = createContext(null);

export function useActiveNode() {
  return useContext(ActiveNodeContext);
}
