import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Mail } from 'lucide-react';
import ContactForm from '../components/ContactForm';

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

  const nextSlide = () => {
    setCurrentSlide(prev => (prev + 1) % featuredPhotos.length);
  };

  const prevSlide = () => {
    setCurrentSlide(prev => (prev - 1 + featuredPhotos.length) % featuredPhotos.length);
  };

  return (
    <div className="min-h-screen bg-gray-50">
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
            
            {/* Navigation Arrows */}
            <button
              onClick={prevSlide}
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-3 rounded-full transition-colors z-10"
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={nextSlide}
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-3 rounded-full transition-colors z-10"
              aria-label="Next photo"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
            
            {/* Slide Indicators */}
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex gap-2 z-10">
              {featuredPhotos.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentSlide(index)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    index === currentSlide ? 'bg-white w-8' : 'bg-white/50'
                  }`}
                  aria-label={`Go to slide ${index + 1}`}
                />
              ))}
            </div>
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
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full max-w-2xl px-4">
            <Link
              to="/events"
              className="bg-white text-black px-6 sm:px-8 py-3 rounded-lg text-base sm:text-lg font-medium hover:bg-gray-100 transition-colors text-center flex-1"
            >
              View Galleries
            </Link>
            <Link
              to="/favorites"
              className="bg-red-600 text-white px-6 sm:px-8 py-3 rounded-lg text-base sm:text-lg font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2 flex-1"
            >
              <span>❤️</span> My Favorites
            </Link>
            <Link
              to="/map"
              className="bg-green-600 text-white px-6 sm:px-8 py-3 rounded-lg text-base sm:text-lg font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2 flex-1"
            >
              <span>📍</span> Map
            </Link>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="max-w-4xl mx-auto py-16 px-4">
        <h2 className="text-3xl font-bold mb-6 text-center">About</h2>
        <div className="prose prose-lg mx-auto text-gray-700 leading-relaxed">
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor 
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud 
            exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
          </p>
          <p>
            Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu 
            fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in 
            culpa qui officia deserunt mollit anim id est laborum.
          </p>
        </div>
      </section>

      {/* Contact Section */}
      <section className="bg-white py-16">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-3xl font-bold mb-8 text-center">Get in Touch</h2>
          
          <ContactForm formId="xdalnwpj" />
          
          <div className="mt-12 flex justify-center gap-8">
            <a
              href="mailto:vantol.thijs@gmail.com"
              className="flex items-center gap-2 text-gray-700 hover:text-blue-600 transition-colors"
            >
              <Mail className="w-5 h-5" />
              <span>vantol.thijs@gmail.com</span>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-gray-400">
            © {new Date().getFullYear()} Thijs van Tol. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
