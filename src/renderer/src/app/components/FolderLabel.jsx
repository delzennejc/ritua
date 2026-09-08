import { createContext, useContext } from "react";
import { Folder } from "@phosphor-icons/react";
import { DEFAULT_AREAS, DEFAULT_AREA_LOOKUP } from "../../../../domain/workspace-defaults";

const AreaFoldersContext = createContext(DEFAULT_AREAS);

const resolveAreaFolder = (areas, channel) => {
  const defaultFolder = DEFAULT_AREA_LOOKUP[channel];
  return areas.find((area) => area.label === channel)
    || (defaultFolder && areas.find((area) => area.id === defaultFolder.id))
    || defaultFolder
    || { label: channel, color: "#8b8b90" };
};

export function AreaFoldersProvider({ areas = DEFAULT_AREAS, children }) {
  return (
    <AreaFoldersContext.Provider value={areas}>
      {children}
    </AreaFoldersContext.Provider>
  );
}

export function useAreaColor(channel = "Ritua") {
  const areas = useContext(AreaFoldersContext);
  return resolveAreaFolder(areas, channel).color;
}

export function FolderLabel({ channel = "Ritua", className = "" }) {
  const areas = useContext(AreaFoldersContext);
  const folder = resolveAreaFolder(areas, channel);

  return (
    <span className={`folder-label ${className}`} style={{ "--folder-color": folder.color }}>
      <Folder className="folder-label-icon" size={14} weight="fill" />
      <span>{folder.label}</span>
    </span>
  );
}
