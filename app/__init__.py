"""
Reviewer Intense - Flask Application Factory
"""

import os
from flask import Flask
from flask_cors import CORS
from app.config import Config


def create_app(config_class=Config):
    """
    Application factory function to create and configure the Flask app.

    Args:
        config_class: Configuration class to use (default: Config)

    Returns:
        Flask application instance
    """
    # Create Flask app instance
    app = Flask(__name__)

    # Load configuration from config class
    config = config_class()

    # Store config in app config
    app.config['KNOWLEDGE_DIR'] = config.KNOWLEDGE_DIR
    app.config['DEBUG'] = config.DEBUG if hasattr(config, 'DEBUG') else True
    app.config['TESTING'] = config.TESTING if hasattr(config, 'TESTING') else False

    # Configure CORS for API routes
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Register blueprints
    from app.routes import api_bp, main_bp
    app.register_blueprint(api_bp)
    app.register_blueprint(main_bp)

    # Initialize database
    from app.database import init_database
    # 数据库文件放在知识库目录的.data子目录中
    knowledge_dir = app.config.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')
    data_dir = os.path.join(knowledge_dir, '.data')
    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, 'reviewer_state.db')
    init_database(db_path)
    print(f"📊 数据库初始化完成: {db_path}")

    return app