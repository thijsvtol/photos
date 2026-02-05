import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Icon, LatLngBounds } from 'leaflet';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { getEvents, getPhotos } from '../api';
import type { Photo } from '../types';

// Fix for default marker icon
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
  shadowSize: [41, 41]
});

interface PhotoWithEvent extends Photo {
  event_slug?: string;
  event_name?: string;
}

interface LocationGroup {
  lat: number;
  lng: number;
  photos: PhotoWithEvent[];
  locationName?: string;
}

// Component to fit map bounds when photos change
const MapBounds: React.FC<{ locations: LocationGroup[] }> = ({ locations }) => {
  const map = useMap();

  useEffect(() => {
    if (locations.length > 0) {
      const bounds = new LatLngBounds(
        locations.map(loc => [loc.lat, loc.lng])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [locations, map]);

  return null;
};

const MapView: React.FC = () => {
  const [locations, setLocations] = useState<LocationGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPhotosWithGPS();
  }, []);

  const loadPhotosWithGPS = async () => {
    try {
      setLoading(true);
      
      // Get all public events
      const events = await getEvents();
      const allPhotos: PhotoWithEvent[] = [];

      // Load photos from each public event (excluding hidden ones)
      for (const event of events) {
        // Skip events starting with [prive] or [hidden]
        if (event.name.toLowerCase().startsWith('[prive]') || 
            event.name.toLowerCase().startsWith('[hidden]')) {
          continue;
        }
        
        if (!event.requires_password) {
          try {
            const photos = await getPhotos(event.slug);
            const photosWithEvent = photos.map(p => ({
              ...p,
              event_slug: event.slug,
              event_name: event.name
            }));
            allPhotos.push(...photosWithEvent);
          } catch (err) {
            console.error(`Failed to load photos for event ${event.slug}:`, err);
          }
        }
      }

      // Filter photos with GPS coordinates and group by location
      const photosWithGPS = allPhotos.filter(p => p.latitude && p.longitude);
      
      // Group photos by approximate location (within 0.01 degrees ~1km)
      const locationMap = new Map<string, LocationGroup>();
      
      photosWithGPS.forEach(photo => {
        // Round coordinates to group nearby photos
        const latKey = Math.round(photo.latitude! * 100) / 100;
        const lngKey = Math.round(photo.longitude! * 100) / 100;
        const key = `${latKey},${lngKey}`;
        
        if (locationMap.has(key)) {
          locationMap.get(key)!.photos.push(photo);
        } else {
          locationMap.set(key, {
            lat: photo.latitude!,
            lng: photo.longitude!,
            photos: [photo]
          });
        }
      });

      setLocations(Array.from(locationMap.values()));
      setError(null);
    } catch (err) {
      setError('Failed to load photo locations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate center of all locations
  const mapCenter = useMemo<[number, number]>(() => {
    if (locations.length === 0) {
      return [52.0907, 5.1214]; // Netherlands default
    }
    const avgLat = locations.reduce((sum, loc) => sum + loc.lat, 0) / locations.length;
    const avgLng = locations.reduce((sum, loc) => sum + loc.lng, 0) / locations.length;
    return [avgLat, avgLng];
  }, [locations]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 flex items-center gap-2">
              📍 Photo Map
            </h1>
            <p className="text-gray-600 mt-2">
              {locations.length} location{locations.length !== 1 ? 's' : ''} with GPS coordinates
            </p>
          </div>
        </div>

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Loading photo locations...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!loading && !error && locations.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600">No photos with GPS coordinates found.</p>
          </div>
        )}

        {!loading && !error && locations.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <MapContainer
              center={mapCenter}
              zoom={8}
              style={{ height: '600px', width: '100%' }}
              className="z-0"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              
              <MapBounds locations={locations} />

              {locations.map((location, index) => {
                // Group photos by event
                const photosByEvent = location.photos.reduce((acc, photo) => {
                  const eventKey = photo.event_slug || 'unknown';
                  if (!acc[eventKey]) {
                    acc[eventKey] = {
                      name: photo.event_name || 'Unknown Event',
                      slug: photo.event_slug || '',
                      photos: []
                    };
                  }
                  acc[eventKey].photos.push(photo);
                  return acc;
                }, {} as Record<string, { name: string; slug: string; photos: PhotoWithEvent[] }>);

                const events = Object.values(photosByEvent);

                return (
                  <Marker
                    key={index}
                    position={[location.lat, location.lng]}
                    icon={defaultIcon}
                  >
                    <Popup maxWidth={400} maxHeight={500}>
                      <div className="p-2 max-h-96 overflow-y-auto">
                        <h3 className="font-semibold text-lg mb-1">
                          {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                        </h3>
                        <p className="text-sm text-gray-600 mb-3">
                          {location.photos.length} photo{location.photos.length !== 1 ? 's' : ''} from {events.length} event{events.length !== 1 ? 's' : ''}
                        </p>
                        
                        {/* Show events and their photos */}
                        <div className="space-y-4">
                          {events.map((event) => (
                            <div key={event.slug} className="border-t pt-3 first:border-t-0 first:pt-0">
                              <Link
                                to={`/events/${event.slug}`}
                                className="text-blue-600 hover:text-blue-700 font-medium mb-2 inline-block"
                              >
                                {event.name} ({event.photos.length})
                              </Link>
                              <div className="grid grid-cols-3 gap-1">
                                {event.photos.slice(0, 6).map((photo) => (
                                  <Link
                                    key={photo.id}
                                    to={`/p/${photo.event_slug}/${photo.id}`}
                                    className="block aspect-square rounded overflow-hidden hover:opacity-80 transition"
                                  >
                                    <img
                                      src={`/media/${photo.event_slug}/preview/${photo.id}.jpg`}
                                      alt={photo.original_filename}
                                      className="w-full h-full object-cover"
                                    />
                                  </Link>
                                ))}
                              </div>
                              {event.photos.length > 6 && (
                                <p className="text-xs text-gray-500 mt-1">
                                  +{event.photos.length - 6} more
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default MapView;
