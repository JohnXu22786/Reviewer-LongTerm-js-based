#!/usr/bin/env python3
"""
Application entry point for Reviewer Intense.
"""

import os
import sys

# Add the app directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app

# Create application instance
app = create_app()

if __name__ == '__main__':
    # Get KNOWLEDGE_DIR from app config for display
    KNOWLEDGE_DIR = app.config.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')

    print("Starting Flask Server...")
    print(f"Knowledge Base Directory: {KNOWLEDGE_DIR}")
    print("Listening at: http://0.0.0.0:1204")
    print("Please visit: http://localhost:1204")
    print("Debug mode: " + ("ON" if app.config.get('DEBUG') else "OFF"))

    # Run the application
    app.run(host='0.0.0.0', port=1204, debug=app.config.get('DEBUG', True))