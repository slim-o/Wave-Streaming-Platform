import { createContext, useContext } from "react";

const ListenerPlayerContext = createContext(null);

export function ListenerPlayerProvider({ value, children }) {
  return (
    <ListenerPlayerContext.Provider value={value}>
      {children}
    </ListenerPlayerContext.Provider>
  );
}

export function useListenerPlayer() {
  const ctx = useContext(ListenerPlayerContext);
  if (!ctx) {
    throw new Error("useListenerPlayer must be used inside ListenerPlayerProvider");
  }
  return ctx;
}
