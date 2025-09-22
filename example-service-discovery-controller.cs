// Example .NET controller to receive service discovery information
// Add this to your Backend1 project

using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;

namespace Backend1.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ConfigController : ControllerBase
    {
        private static Dictionary<string, ServiceInfo> _otherServices = new();

        [HttpPost("services")]
        public IActionResult UpdateServices([FromBody] ServiceDiscoveryPayload payload)
        {
            try
            {
                _otherServices = payload.Services;
                
                // Log the received services
                foreach (var service in _otherServices)
                {
                    Console.WriteLine($"Discovered service: {service.Key} at {service.Value.Url}");
                }

                return Ok(new { message = "Services updated successfully" });
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpGet("services")]
        public IActionResult GetServices()
        {
            return Ok(_otherServices);
        }

        // Method to get a specific service URL (use this in your business logic)
        public static string GetServiceUrl(string serviceName)
        {
            return _otherServices.TryGetValue(serviceName, out var service) 
                ? service.Url 
                : null;
        }
    }

    public class ServiceDiscoveryPayload
    {
        public Dictionary<string, ServiceInfo> Services { get; set; } = new();
    }

    public class ServiceInfo
    {
        public int Port { get; set; }
        public string Url { get; set; }
    }
}

// Usage example in your business logic:
/*
public class SomeBusinessService
{
    public async Task CallBackend2()
    {
        var backend2Url = ConfigController.GetServiceUrl("backend2");
        if (backend2Url != null)
        {
            // Make HTTP call to backend2
            using var client = new HttpClient();
            var response = await client.GetAsync($"{backend2Url}/api/someendpoint");
            // ... handle response
        }
    }
}
*/