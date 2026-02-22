"""
Main routes for Reviewer Intense application.
Serves frontend pages and static files.
"""

import os
from flask import Blueprint, send_from_directory, current_app

# Create main blueprint (no URL prefix for main routes)
main_bp = Blueprint('main', __name__)


@main_bp.route('/')
def serve_home():
    """Serve the home page (knowledge base selection)."""
    return send_from_directory('templates', 'file-selector.html')


@main_bp.route('/review')
def serve_review():
    """Serve the review page."""
    return send_from_directory('templates', 'index.html')


@main_bp.route('/report')
def serve_report():
    """Serve the report.html page."""
    return send_from_directory('templates', 'report.html')


@main_bp.route('/edit')
def serve_editor():
    """Serve the knowledge base editor page."""
    return send_from_directory('templates', 'editor.html')


@main_bp.route('/new')
def serve_new_kb():
    """Serve the new knowledge base creation page."""
    return send_from_directory('templates', 'new-kb.html')


@main_bp.route('/file-selector')
def serve_file_selector():
    """Serve the file-selector.html page (legacy, redirect to home)."""
    from flask import redirect
    return redirect('/')


@main_bp.route('/<path:filename>')
def serve_static(filename):
    """Serve static files (JS, CSS, favicon)."""
    # Check if file exists in static directory
    static_dir = os.path.join(current_app.root_path, 'static')

    # Security check: prevent directory traversal
    if '..' in filename or filename.startswith('/'):
        return "Invalid filename", 400

    # Try to serve from static directory
    return send_from_directory(static_dir, filename)