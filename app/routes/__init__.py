"""
Routes package for Reviewer Intense application.
Exports blueprints for use in application factory.
"""

from .api import api_bp
from .main import main_bp

__all__ = ['api_bp', 'main_bp']