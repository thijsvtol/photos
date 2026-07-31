import React, { useEffect, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import { Icon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import ModalOverlay from './ModalOverlay';

// Leaflet's default marker icon resolves its image URLs relative to the page
// (via document.location), which breaks under Vite/webpack bundling — the
// icon silently fails to load and no marker is shown at all. Import the
// marker assets explicitly and build an Icon from them, same fix already
// used in pages/MapView.tsx.
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const defaultIcon = new Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface EventLocationPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSetLocation: (lat: number, lng: number) => void;
}

const DEFAULT_MAP_CENTER: [number, number] = [52.6324, 4.7534];

/** Leaflet measures its container's size when the map is created. Since this
 *  map is rendered inside a modal that's still animating open (slide-in +
 *  fade), the container can be zero-height/width (or mid-transition) at that
 *  moment, leaving the map (and any markers) blank until the window happens
 *  to resize. Re-measuring once the modal's open transition has finished
 *  fixes the tiles/markers without needing to touch the modal itself. */
const InvalidateSizeOnMount: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
};

export default function EventLocationPicker({ isOpen, onClose, onSetLocation }: EventLocationPickerProps) {
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(null);

  // Map click handler component
  const LocationMarker: React.FC = () => {
    useMapEvents({
      click(e) {
        setSelectedLocation([e.latlng.lat, e.latlng.lng]);
      },
    });
    
    return selectedLocation ? <Marker position={selectedLocation} icon={defaultIcon} /> : null;
  };

  const handleSetLocation = () => {
    if (selectedLocation) {
      onSetLocation(selectedLocation[0], selectedLocation[1]);
      setSelectedLocation(null);
    }
  };

  const handleClose = () => {
    setSelectedLocation(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay onClose={handleClose} label="Set GPS location for event">
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] h-[600px] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-start gap-4">
          <div className="flex-1">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              <span>Set GPS Location for Event</span>
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
              Click on the map to select a location. This will update photos without GPS data.
            </p>
          </div>
          <button 
            onClick={handleClose} 
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 relative">
          <MapContainer
            center={selectedLocation || DEFAULT_MAP_CENTER}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <LocationMarker />
            <InvalidateSizeOnMount />
          </MapContainer>
        </div>
        <div className="p-4 sm:p-6 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
            {selectedLocation ? (
              <>
                <MapPin className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span>Selected: {selectedLocation[0].toFixed(6)}, {selectedLocation[1].toFixed(6)}</span>
              </>
            ) : (
              <span>Click on the map to select a location</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="flex-1 sm:flex-none px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm sm:text-base"
            >
              Cancel
            </button>
            <button
              onClick={handleSetLocation}
              disabled={!selectedLocation}
              className="flex-1 sm:flex-none px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <MapPin className="w-4 h-4" />
              <span>Set Location</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalOverlay>
  );
}
