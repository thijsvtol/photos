import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import SEO from '../components/SEO';
import { getConfig } from '../config';

const PhotoUsage: React.FC = () => {
  const config = getConfig();
  
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <SEO
        title={`Photo Usage Rights - ${config.appName}`}
        description={`Learn how you can use photos from ${config.brandName}'s photography website. Guidelines for personal and commercial use.`}
        keywords="photo usage, photo rights, image licensing, photography terms"
        url={`https://${config.domain}/usage`}
      />
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex-grow">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">Photo Usage Rights</h1>
        
        <div className="bg-white rounded-xl shadow-md p-6 sm:p-8 space-y-6">
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">Personal Use</h2>
            <p className="text-gray-700 leading-relaxed">
              You are welcome to <strong>download and use photos for personal purposes</strong>, including:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2 text-gray-700 ml-4">
              <li>Personal social media posts (Facebook, Instagram, Twitter, etc.)</li>
              <li>Personal websites or portfolios (if you appear in the photo)</li>
              <li>Printing for personal use (frames, albums, etc.)</li>
              <li>Sharing with friends and family</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">Required Attribution</h2>
            <p className="text-gray-700 leading-relaxed mb-3">
              When sharing photos publicly (e.g., on social media), please credit the photographer, below an example:
            </p>
            <div className="bg-gray-100 rounded-lg p-4 border border-gray-200">
              <p className="font-mono text-sm text-gray-800">
                📷 Photo by <strong>{config.brandName}</strong><br />
                🌐 {window.location.hostname}
              </p>
            </div>
            <p className="text-gray-600 text-sm mt-2 italic">
              Attribution helps support the photographer and allows others to discover more great photos!
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">Commercial Use</h2>
            <p className="text-gray-700 leading-relaxed">
              For <strong>commercial use</strong> (advertising, promotional materials, product sales, etc.), 
              please <strong>contact me first</strong> for permission and licensing arrangements.
            </p>
            <p className="text-gray-700 leading-relaxed mt-3">
              Commercial use includes but is not limited to:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-2 text-gray-700 ml-4">
              <li>Business advertising and marketing materials</li>
              <li>Product packaging or merchandise</li>
              <li>Corporate websites or publications</li>
              <li>Editorial use in publications (magazines, newspapers)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">What's Not Allowed</h2>
            <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
              <li><strong>Reselling or redistributing</strong> photos (as stock photos or downloads)</li>
              <li><strong>Claiming ownership</strong> or removing watermarks/metadata</li>
              <li><strong>Using photos to represent yourself</strong> if you're not the person in the photo</li>
              <li><strong>Altering photos</strong> in misleading or harmful ways</li>
              <li>Any use that violates laws or infringes on rights of people in the photos</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">Privacy & Takedown Requests</h2>
            <p className="text-gray-700 leading-relaxed">
              If you appear in a photo and would like it removed or made private, please contact me with:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-2 text-gray-700 ml-4">
              <li>The event name and date</li>
              <li>The photo filename or a link to the photo</li>
              <li>Your request (removal or password-protect the event)</li>
            </ul>
            <p className="text-gray-700 leading-relaxed mt-3">
              I respect your privacy and will process takedown requests promptly.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">Contact</h2>
            <p className="text-gray-700 leading-relaxed">
              For licensing inquiries, commercial use requests, or any questions about photo usage:
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-4">
              <Link 
                to="/#contact" 
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-center justify-center font-medium shadow-sm"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Contact via Form
              </Link>
            </div>
          </section>

          <section className="border-t pt-6">
            <p className="text-sm text-gray-600">
              <strong>Copyright Notice:</strong> All photos on this website are © {new Date().getFullYear()} {config.copyrightHolder}. 
              All rights reserved unless otherwise stated. By downloading or using photos, you agree to these terms.
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default PhotoUsage;
