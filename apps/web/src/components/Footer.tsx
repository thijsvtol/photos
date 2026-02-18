import { Link } from 'react-router-dom';
import { config } from '../config';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-white py-8 mt-auto">
      <div className="max-w-4xl mx-auto px-4 text-center">
        <div className="mb-4 flex justify-center gap-6">
          <Link 
            to="/usage" 
            className="text-blue-400 hover:text-blue-300 transition-colors text-sm font-medium"
          >
            Photo Usage Rights
          </Link>
          <Link 
            to="/privacy" 
            className="text-blue-400 hover:text-blue-300 transition-colors text-sm font-medium"
          >
            Privacy Policy
          </Link>
        </div>
        <p className="text-gray-400 text-sm">
          © {new Date().getFullYear()} {config.copyrightHolder}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
