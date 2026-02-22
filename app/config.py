"""
Configuration settings for Reviewer Intense application.
"""

import os
import json
from pathlib import Path


class Config:
    """Base configuration."""
    # Flask configuration
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'

    # Application configuration
    KNOWLEDGE_DIR = None  # Will be loaded from config.json

    # API configuration
    JSON_AS_ASCII = False  # Ensure JSON responses support UTF-8

    def __init__(self):
        """Load configuration from config.json file."""
        self.load_from_file()

    def load_from_file(self):
        """Load configuration from config.json file."""
        try:
            # Try to find config.json relative to app directory
            config_path = Path(__file__).parent.parent / 'config.json'
            with open(config_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)

            self.KNOWLEDGE_DIR = config_data.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')

        except FileNotFoundError:
            print(f"⚠️ config.json not found. Using default paths.")
            self.KNOWLEDGE_DIR = 'D:\\knowledge_bases'
        except json.JSONDecodeError as e:
            print(f"⚠️ Error parsing config.json: {e}. Using default paths.")
            self.KNOWLEDGE_DIR = 'D:\\knowledge_bases'


class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True


class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False


class TestingConfig(Config):
    """Testing configuration."""
    TESTING = True
    DEBUG = True


# Configuration dictionary
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}