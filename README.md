# Full-Stack Login/Register System

This project implements a complete login/register system using Supabase for authentication and database, a FastAPI backend, and a React (Vite) frontend.

## Project Structure

```
project/
├── backend_python/      # FastAPI backend application
│   ├── src/
│   │   └── main.py      # Main FastAPI application logic
│   ├── .env             # Environment variables (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
│   └── requirements.txt # Python dependencies
├── frontend_react/      # React (Vite) frontend application
│   ├── src/
│   │   ├── components/    # (Optional, if you created any reusable components)
│   │   ├── pages/         # React components for each page (LoginPage, RegisterPage, etc.)
│   │   ├── App.jsx        # Main App component with routing
│   │   ├── AuthContext.jsx # React Context for authentication
│   │   ├── PrivateRoute.jsx # Component for protected routes
│   │   ├── supabaseClient.js # Supabase client initialization
│   │   └── index.css      # Main CSS file with Tailwind directives
│   ├── .env             # Environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
│   ├── tailwind.config.js # Tailwind CSS configuration
│   ├── postcss.config.js  # PostCSS configuration
│   └── package.json     # NPM dependencies and scripts
└── supabase_setup.sql   # SQL script for Supabase database setup
```

## Setup Instructions

### 1. Supabase Setup

*   Create a new project on [Supabase](https://supabase.com/).
*   Navigate to the SQL Editor in your Supabase project dashboard.
*   Open the `supabase_setup.sql` file provided in this project.
*   Copy the entire content of the SQL script and run it in the Supabase SQL Editor. This will create the `profiles` table, enable Row-Level Security (RLS), add necessary policies, and set up a trigger to create a profile when a new user signs up.
*   **Enable Google Authentication (Optional but recommended for full functionality):**
    * Go to the Google Cloud Console https://console.cloud.google.com/ and create a new project
    * Go to APIs & Services -> Credentials.
    * Configure the OAuth consent screen
    * Create OAuth 2.0 credentials
        * Application type: Web application
        * Add the Authorized Javascript origins: (e.g., `http://localhost:5173` for local development).
        * Add the Authorized Redirect URI: (e.g., `http://localhost:5173/auth/callback` for local development, https://your-supabase-url.supabase.co/auth/v1/callback for Supabase).
    * In your Supabase project, go to Authentication -> Providers.
    *   Enable the Google provider and follow the instructions to configure it with your Google Cloud Platform credentials (OAuth 2.0 client ID and secret).
    *   Ensure your site URL and redirect URI are correctly configured in Supabase (e.g., `http://localhost:5173` for local frontend development).
*   **Obtain Supabase Credentials:**
    *   Go to Project Settings -> API.
    *   You will find your `Project URL` (this is your `SUPABASE_URL` and `VITE_SUPABASE_URL`).
    *   You will find your `anon` `public` key (this is your `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`).
    *   You will find your `service_role` `secret` key (this is your `SUPABASE_SERVICE_ROLE_KEY` for the backend).

### 2. Backend Setup (FastAPI)

*   Navigate to the `project/backend_python` directory.
*   **Create and activate a virtual environment:**
    ```bash
    python3.11 -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```
*   **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
*   **Configure environment variables:**
    *   Create or open the `.env` file in the `project/backend_python` directory.
    *   Add your Supabase credentials:
        ```env
        SUPABASE_URL=your_supabase_url_here
        SUPABASE_ANON_KEY=your_supabase_anon_key_here
        SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
        ```
        Replace `your_supabase_url_here`, `your_supabase_anon_key_here`, and `your_supabase_service_role_key_here` with the actual values from your Supabase project.
*   **Run the backend server:**
    ```bash
    uvicorn src.main:app --reload --port 8000
    ```
    The backend will be running on `http://localhost:8000`.

### 3. Frontend Setup (React + Vite)

*   Navigate to the `project/frontend_react` directory.
*   **Install dependencies:**
    ```bash
    npm install
    ```
*   **Configure environment variables:**
    *   Create or open the `.env` file in the `project/frontend_react` directory.
    *   Add your Supabase credentials:
        ```env
        VITE_SUPABASE_URL=your_supabase_url_here
        VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
        ```
        Replace `your_supabase_url_here` and `your_supabase_anon_key_here` with the actual values from your Supabase project.
*   **Run the frontend development server:**
    ```bash
    npm run dev
    ```
    The frontend will be running on `http://localhost:5173` (or another port if 5173 is busy).


*   **Additional Notes:**
    * Install React Router Dom
    ```bash
    npm install react-router-dom
    ```
    * Install PostCSS plugin
    ```bash
    npm install -D @tailwindcss/postcss
    ```
    * Modify your postcss.config.js file to use the new package

    ```javascript
    import autoprefixer from 'autoprefixer';
    import tailwindcss from '@tailwindcss/postcss';

    export default {
    plugins: [tailwindcss, autoprefixer],
    };
    ```
    * Install Tailwind CSS and its peer dependencies:
    ```bash
    npm install tailwindcss @tailwindcss/vite
    ```
    * Update vite.config.js to include Tailwind CSS:
    ```javascript
    import tailwindcss from '@tailwindcss/vite';
    
    export default {
    plugins: [tailwindcss()],
    };
    ```

    * Add an @import to index.css that imports Tailwind CSS
    ```tailwind.css
    @import "tailwindcss";
    ```
  
    

   - If issues persists, try removing node_modules and reinstalling everything:

  ```javascript
  cmd:
  rm -rf node_modules package-lock.json
  powershell:
  Remove-Item -Recurse -Force node_modules, package-lock.json

  npm install
  ```

## Usage

1.  Ensure both the backend and frontend servers are running.
2.  Open your browser and navigate to the frontend URL (e.g., `http://localhost:5173`).
3.  You can now register new users, log in with email/password or Google, manage profiles, and access protected routes based on authentication and roles.

## Key Features Implemented

*   User registration (email/password)
*   User login (email/password, Google OAuth)
*   Profile creation and updates (username, first name, last name)
*   Automatic profile creation for new users via Supabase trigger.
*   Row-Level Security (RLS) on profiles table.
*   Protected routes for authenticated users.
*   Role-based access control (e.g., `/admin` route for users with `admin` role).
*   JWT authentication for backend API (`/api/profile/me`).
*   Frontend state management for authentication using React Context.
*   UI/UX best practices including form validation, loading states, and feedback messages.
*   Responsive design with Tailwind CSS.
*   Handling for new Google users to complete their profile information.


