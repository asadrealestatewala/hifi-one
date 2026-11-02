import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

// Loads a GET endpoint, with pull-to-refresh state and a readable error.
export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try { setData(await api<T>(path)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    setRefreshing(false);
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, setData, error, refreshing, reload: load };
}
