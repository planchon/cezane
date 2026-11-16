import { createContext, useContext } from "react";
import type { RenderAsset } from "@cezane/core";

export const AssetsContext = createContext<Record<string, RenderAsset>>({});
export const useAssets = () => useContext(AssetsContext);
