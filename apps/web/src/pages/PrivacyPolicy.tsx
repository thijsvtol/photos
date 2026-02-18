import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import SEO from '../components/SEO';
import { getConfig } from '../config';

const PrivacyPolicy: React.FC = () => {
  const config = getConfig();
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <SEO
        title={`Privacy Policy - ${config.appName}`}
        description={`Privacy policy for ${config.brandName}'s photography website. Learn how we collect, use, and protect your personal information.`}
        keywords="privacy policy, data protection, GDPR, personal information, photo privacy"
        url={`https://${config.domain}/privacy`}
      />
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex-grow">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-8">Privacy Policy</h1>
        
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6 sm:p-8 space-y-6">
          <section>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              This Privacy Policy describes how {config.brandName} ("we", "us", or "our") collects, uses, and protects 
              your personal information when you use our photography website at {config.domain} (the "Service").
            </p>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-3">
              <strong>Last Updated:</strong> {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">1. Information We Collect</h2>
            
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2 mt-4">1.1 Information You Provide</h3>
            <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300 ml-4">
              <li><strong>Account Information:</strong> When you create an account or access password-protected events, we collect your email address and optionally your name.</li>
              <li><strong>Contact Information:</strong> When you contact us through our contact form, we collect your name, email address, and message content.</li>
              <li><strong>Favorites & Preferences:</strong> We store information about photos you favorite and your preferences for viewing events.</li>
            </ul>

            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2 mt-4">1.2 Automatically Collected Information</h3>
            <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300 ml-4">
              <li><strong>Usage Data:</strong> We collect information about how you interact with the Service, including pages viewed, photos downloaded, and features used.</li>
              <li><strong>Device Information:</strong> We may collect information about your device, including IP address, browser type, operating system, and screen resolution.</li>
              <li><strong>Cookies:</strong> We use cookies and similar technologies to maintain your session, remember your preferences, and improve your experience.</li>
            </ul>

            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2 mt-4">1.3 Photos and EXIF Data</h3>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed ml-4">
              Photos uploaded to the Service may contain EXIF metadata (e.g., camera model, date taken, GPS location). 
              We extract and display some of this information (camera model, date) publicly. GPS location data, if present, 
              may be used to show photos on a map but can be removed upon request.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">2. How We Use Your Information</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
              We use the collected information for the following purposes:
            </p>
            <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300 ml-4">
              <li><strong>Provide the Service:</strong> To operate and maintain the photography platform, including event galleries and photo viewing.</li>
              <li><strong>User Authentication:</strong> To manage user accounts and control access to password-protected events.</li>
              <li><strong>Personalization:</strong> To remember your favorites, preferences, and provide a personalized experience.</li>
              <li><strong>Communication:</strong> To respond to your inquiries, send event notifications (if you've opted in), and provide customer support.</li>
              <li><strong>Analytics & Improvements:</strong> To understand how the Service is used and improve its performance and features.</li>
              <li><strong>Security:</strong> To detect and prevent fraud, abuse, and security issues.</li>
              <li><strong>Legal Compliance:</strong> To comply with legal obligations and protect our rights.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">3. Data Storage and Security</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              We take reasonable measures to protect your personal information from unauthorized access, disclosure, alteration, and destruction:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2 text-gray-700 dark:text-gray-300 ml-4">
              <li>Data is stored on secure servers provided by Cloudflare (Cloudflare Workers, R2, and D1).</li>
              <li>We use encryption for data transmission (HTTPS/TLS).</li>
              <li>Access to personal data is restricted to authorized personnel only.</li>
              <li>We regularly review and update our security practices.</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-3">
              However, no method of transmission over the Internet or electronic storage is 100% secure. 
              While we strive to protect your information, we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">4. Data Sharing and Disclosure</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
              We do not sell, rent, or trade your personal information. We may share information in the following limited circumstances:
            </p>
            <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300 ml-4">
              <li><strong>Service Providers:</strong> With third-party service providers (e.g., Cloudflare, email services) who assist in operating the Service. These providers are bound by confidentiality agreements.</li>
              <li><strong>Legal Requirements:</strong> When required by law, legal process, or to protect our rights, property, or safety.</li>
              <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets, your information may be transferred to the acquiring entity.</li>
              <li><strong>With Your Consent:</strong> We may share information with your explicit consent for specific purposes.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">5. Your Rights and Choices</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
              You have the following rights regarding your personal information:
            </p>
            <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300 ml-4">
              <li><strong>Access:</strong> You can request access to the personal information we hold about you.</li>
              <li><strong>Correction:</strong> You can request correction of inaccurate or incomplete information.</li>
              <li><strong>Deletion:</strong> You can request deletion of your account and associated personal data.</li>
              <li><strong>Data Portability:</strong> You can request a copy of your data in a machine-readable format.</li>
              <li><strong>Opt-Out:</strong> You can opt out of receiving marketing communications at any time.</li>
              <li><strong>Cookie Settings:</strong> You can control cookies through your browser settings.</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-3">
              To exercise these rights, please <Link to="/#contact" className="text-blue-600 dark:text-blue-400 hover:underline">contact us</Link>. 
              We will respond to your request within a reasonable timeframe.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">6. Photos of You</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              If you appear in a photo published on this Service and would like it removed or made private, you have the right to request:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-2 text-gray-700 dark:text-gray-300 ml-4">
              <li>Removal of specific photos</li>
              <li>Password protection of an entire event</li>
              <li>Blurring of your face in photos</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-3">
              Please <Link to="/#contact" className="text-blue-600 dark:text-blue-400 hover:underline">contact us</Link> with 
              the event name, date, and photo details. We respect your privacy and will process takedown requests promptly.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">7. Cookies and Tracking Technologies</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
              We use cookies and similar technologies to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300 ml-4">
              <li><strong>Essential Cookies:</strong> Required for authentication and basic website functionality</li>
              <li><strong>Preference Cookies:</strong> Remember your settings (dark mode, language)</li>
              <li><strong>Analytics Cookies:</strong> Help us understand usage patterns and improve the Service</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-3">
              You can control cookies through your browser settings, but disabling cookies may limit certain features of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">8. Data Retention</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              We retain your personal information for as long as necessary to provide the Service and fulfill the purposes outlined in this policy:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-2 text-gray-700 dark:text-gray-300 ml-4">
              <li>Account information is retained until you delete your account</li>
              <li>Photos and events are retained indefinitely unless removal is requested</li>
              <li>Contact form messages are retained for customer service purposes</li>
              <li>Usage logs and analytics data may be retained for up to 2 years</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">9. Children's Privacy</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              The Service is not directed to children under 13 years of age. We do not knowingly collect personal information from children under 13. 
              If you believe we have collected information from a child under 13, please <Link to="/#contact" className="text-blue-600 dark:text-blue-400 hover:underline">contact us</Link> immediately.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">10. International Data Transfers</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              Your information may be transferred to and processed in countries other than your country of residence. 
              These countries may have different data protection laws. By using the Service, you consent to the transfer 
              of your information to our servers and service providers wherever located.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">11. Changes to This Privacy Policy</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              We may update this Privacy Policy from time to time to reflect changes in our practices or legal requirements. 
              We will notify you of significant changes by posting a notice on the Service or sending an email to registered users. 
              The "Last Updated" date at the top of this policy indicates when it was last revised.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">12. Contact Us</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
              If you have questions, concerns, or requests regarding this Privacy Policy or how we handle your personal information, please contact us:
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-4">
              <Link 
                to="/#contact" 
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-center justify-center font-medium shadow-sm"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Contact Us
              </Link>
            </div>
          </section>

          <section className="border-t dark:border-gray-700 pt-6">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <strong>Your Consent:</strong> By using this Service, you acknowledge that you have read and understood this Privacy Policy 
              and consent to the collection, use, and disclosure of your information as described herein.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">
              For information about how you can use photos from this website, please see our <Link to="/usage" className="text-blue-600 dark:text-blue-400 hover:underline">Photo Usage Rights</Link> page.
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
