import React, { useState } from 'react';
import { useAuth } from '../../AuthContext.jsx'; // Adjusted path if AuthContext is in src
import { useNavigate } from 'react-router-dom';
import { Button, Input, Form, Label, Card } from "@/components/ui";

const RegisterPage = () => {
  const { signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState('');

  const checkPasswordStrength = (pw) => {
    let strength = 0;
    if (pw.length >= 8) strength += 1;
    if (pw.match(/[a-z]/)) strength += 1;
    if (pw.match(/[A-Z]/)) strength += 1;
    if (pw.match(/[0-9]/)) strength += 1;
    if (pw.match(/[^a-zA-Z0-9]/)) strength += 1;

    if (strength < 2) setPasswordStrength('Weak');
    else if (strength < 4) setPasswordStrength('Medium');
    else setPasswordStrength('Strong');
  };

  const handlePasswordChange = (e) => {
    const newPassword = e.target.value;
    setPassword(newPassword);
    checkPasswordStrength(newPassword);
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setIsEmailLoading(true);
    try {
      const { error: signUpError } = await signUp({ email, password });
      if (signUpError) {
        throw signUpError;
      }
      alert('Registration successful!');
      navigate('/login');
    } catch (err) {
      setError(err.message || 'Failed to register. Please try again.');
      console.error('Registration error:', err);
    }
    setIsEmailLoading(false);
  };

  const handleGoogleSignUp = async () => {
    setError('');
    setIsGoogleLoading(true);
    try {
      const { error: googleError } = await signInWithGoogle();
      if (googleError) {
        throw googleError;
      }
      // Supabase handles redirection for OAuth, so we might not need to navigate explicitly here
      // unless onAuthStateChange handles it. For now, assume Supabase redirects or AuthContext handles it.
    } catch (err) {
      setError(err.message || 'Failed to Signup with Google.');
      console.error('Google login error:', err);
      setIsGoogleLoading(false);
    }
    // setLoading(false); // Might not be reached if Supabase redirects
  };

  return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Card className="bg-white p-8 rounded-lg shadow-md w-full max-w-md !border-0">
          <h2 className="text-2xl font-bold mb-0 text-center text-gray-800">Register</h2>
          {error && <p className="bg-red-100 text-red-700 p-3 rounded mb-0 text-sm">{error}</p>}
          <Form onSubmit={handleSignUp}>
            <div className="mb-0">
              <Label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</Label>
              <Input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="you@example.com"
              />
            </div>
            <div className="mb-0">
              <Label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</Label>
              <Input
                  type="password"
                  id="password"
                  value={password}
                  onChange={handlePasswordChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="••••••••"
              />
              {password && (
                  <p className={`text-xs mt-1 ${passwordStrength === 'Strong' ? 'text-green-500' : passwordStrength === 'Medium' ? 'text-yellow-500' : 'text-red-500'}`}>
                    Password Strength: {passwordStrength}
                  </p>
              )}
            </div>
            <div className="mb-0">
              <Label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</Label>
              <Input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="••••••••"
              />
            </div>
            <Button
                type="submit"
                disabled={isEmailLoading || (password && passwordStrength === 'Weak')}
                onClick={handleSignUp}
                className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isEmailLoading ? 'Registering...' : 'Register'}
            </Button>
          </Form>

          <div className="relative text-center text-sm my-1 after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-gray-300">
          <span className="relative z-10 bg-white px-2 text-gray-500">
            Or continue with
          </span>
          </div>

          <Button
              variant="outline"
              className="w-full hover:bg-gray-100 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50"
              onClick={handleGoogleSignUp}
              disabled={isGoogleLoading}
          >
            {isGoogleLoading ? (
                'Processing...'
            ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4 mr-2">
                    <path
                        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                        fill="currentColor"
                    />
                  </svg>
                  Sign up with Google
                </>
            )}
          </Button>

          <p className="mt-0 text-center text-sm text-gray-600">
            Already have an account? <a href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">Login here</a>
          </p>
        </Card>
      </div>
  );
};

export default RegisterPage;

