import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Heart, MapPin } from 'lucide-react';
import ContactForm from '../components/ContactForm';
import Footer from '../components/Footer';
import SEO from '../components/SEO';

interface FeaturedPhoto {
  id: string;
  event_slug: string;
  event_name: string;
  blur_placeholder: string | null;
}

export default function Landing() {
  const [featuredPhotos, setFeaturedPhotos] = useState<FeaturedPhoto[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    fetch('/api/photos/featured?limit=10')
      .then(res => res.json())
      .then(data => {
        setFeaturedPhotos(data.photos || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load featured photos:', err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (featuredPhotos.length === 0) return;
    
    const interval = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % featuredPhotos.length);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [featuredPhotos.length]);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Thijs van Tol Photos',
    url: 'https://photos.thijsvtol.nl',
    description: 'Professional event photography featuring ice skating, inline skating, and sports events',
    author: {
      '@type': 'Person',
      name: 'Thijs van Tol',
      url: 'https://thijsvtol.nl'
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://photos.thijsvtol.nl/events?search={search_term_string}',
      'query-input': 'required name=search_term_string'
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <SEO
        title="Photos - Thijs van Tol | Professional Event Photography"
        description="Professional event photography featuring ice skating, inline skating, and sports events. Browse high-quality photos and download your favorites."
        keywords="photography, sports photography, ice skating photography, inline skating, event photography, Thijs van Tol"
        url="https://photos.thijsvtol.nl/"
        structuredData={structuredData}
      />
      {/* Hero Section with Slideshow */}
      <section className="relative h-screen bg-black overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-white text-xl">Loading...</div>
          </div>
        ) : featuredPhotos.length > 0 ? (
          <>
            {/* Slideshow Images */}
            {featuredPhotos.map((photo, index) => (
              <div
                key={photo.id}
                className={`absolute inset-0 transition-opacity duration-1000 ${
                  index === currentSlide ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <img
                  src={`/media/${photo.event_slug}/preview/${photo.id}.jpg`}
                  alt={photo.event_name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-white text-xl">No featured photos available</div>
          </div>
        )}
        
        {/* Hero Text Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black/50">
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-4 text-center px-4 drop-shadow-2xl">
            Thijs van Tol Photo's
          </h1>
          <p className="text-xl md:text-2xl text-white mb-8 text-center px-4 drop-shadow-lg">
            Capturing moments in sports and nature
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-4 w-full max-w-2xl px-4">
            <Link
              to="/events"
              className="bg-white/90 backdrop-blur-sm text-gray-900 px-6 sm:px-8 py-4 rounded-xl text-base sm:text-lg font-semibold hover:bg-white active:scale-95 transition-all text-center flex-1 shadow-lg"
            >
              View Galleries
            </Link>
            <Link
              to="/favorites"
              className="bg-white/20 backdrop-blur-sm border-2 border-white/40 text-white px-6 sm:px-8 py-4 rounded-xl text-base sm:text-lg font-semibold hover:bg-white/30 active:scale-95 transition-all flex items-center justify-center gap-2 flex-1 shadow-lg"
            >
              <Heart className="w-5 h-5" /> <span>Favorites</span>
            </Link>
            <Link
              to="/map"
              className="bg-white/20 backdrop-blur-sm border-2 border-white/40 text-white px-6 sm:px-8 py-4 rounded-xl text-base sm:text-lg font-semibold hover:bg-white/30 active:scale-95 transition-all flex items-center justify-center gap-2 flex-1 shadow-lg"
            >
              <MapPin className="w-5 h-5" /> <span>Map</span>
            </Link>
          </div>
        </div>
        
        {/* Scroll indicator */}
        <div 
          className="absolute bottom-8 left-0 right-0 flex flex-col items-center animate-bounce z-20 transition-opacity duration-300"
          style={{ opacity: Math.max(0, 1 - scrollY / 300) }}
        >
          <span className="text-white text-sm mb-2 drop-shadow-lg">Scroll to explore</span>
          <ChevronDown className="w-8 h-8 text-white drop-shadow-lg" />
        </div>
      </section>

      {/* Contact Section */}
      <section className="bg-white py-16">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-3xl font-bold mb-8 text-center">Get in Touch</h2>
          
          <ContactForm formId="xdalnwpj" />

        </div>
      </section>

      <Footer />
    </div>
  );
}
