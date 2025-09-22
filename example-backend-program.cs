// Example Program.cs for your .NET backend applications
// This shows how to support OS-assigned ports

using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;

namespace Backend1
{
    public class Program
    {
        public static void Main(string[] args)
        {
            CreateHostBuilder(args).Build().Run();
        }

        public static IHostBuilder CreateHostBuilder(string[] args) =>
            Host.CreateDefaultBuilder(args)
                .ConfigureWebHostDefaults(webBuilder =>
                {
                    webBuilder.UseStartup<Startup>();
                    
                    // Support --urls parameter for OS-assigned ports
                    // When called with --urls http://localhost:0
                    // ASP.NET Core will bind to any available port
                    webBuilder.UseUrls(); // This reads from --urls command line arg
                });
    }
}

// Alternative: If you want to handle port assignment manually
/*
public class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        
        // Configure services
        builder.Services.AddControllers();
        
        var app = builder.Build();
        
        // Configure pipeline
        app.UseRouting();
        app.MapControllers();
        
        // Add health check endpoint (optional but recommended)
        app.MapGet("/health", () => "OK");
        
        // Run with OS-assigned port if --urls is provided
        app.Run();
    }
}
*/